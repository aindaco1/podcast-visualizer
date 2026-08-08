import Foundation
import Observation
import PodcastVisualizerCore

@MainActor
@Observable
final class TranscriptReviewStore {
    private(set) var workspace: ReviewWorkspace?
    private(set) var speakerDefinitions: [ReviewSpeaker] = []
    var cues: [ReviewCue] = []
    var selectedSpeaker: String?
    var mergeSource: String?
    var mergeTarget: String?
    var renameSpeakerID: String? {
        didSet { speakerNameDraft = renameSpeakerID.map(displayName) ?? "" }
    }
    var speakerNameDraft = ""
    var findText = ""
    var replacementText = ""
    var caseSensitive = false
    var wholeWords = false
    var statusMessage = "Review is not loaded"
    private(set) var isLoading = false
    private(set) var isDirty = false
    let audioPlayer = LocalAudioPlayer()

    var speakers: [String] { speakerDefinitions.map(\.id) }

    var canAddSpeaker: Bool { speakerDefinitions.count < ReviewSpeaker.maximumCount }

    var canDeleteSpeaker: Bool {
        renameSpeakerID.map { speakers.contains($0) } == true
    }

    var canRenameSpeaker: Bool {
        guard let renameSpeakerID,
              let name = ReviewEditing.normalizedSpeakerDisplayName(speakerNameDraft)
        else { return false }
        return name != displayName(renameSpeakerID)
    }

    var visibleCueIndices: [Int] {
        guard let selectedSpeaker else { return Array(cues.indices) }
        return cues.indices.filter { cues[$0].speakerLabel == selectedSpeaker }
    }

    var speakerCounts: [String: Int] {
        Dictionary(grouping: cues, by: \.speakerLabel).mapValues(\.count)
    }

    var replacementPreviewCount: Int {
        ReviewEditing.replaceAll(
            findText,
            with: replacementText,
            in: cues,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        ).replacements
    }

    var canApprove: Bool {
        let speakerIDs = Set(speakers)
        return !cues.isEmpty
            && speakerDefinitions.allSatisfy {
                ReviewEditing.normalizedSpeakerDisplayName($0.displayName) == $0.displayName
            }
            && cues.allSatisfy {
                !$0.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && speakerIDs.contains($0.speakerLabel) && $0.speakerConfirmed
            }
    }

    var editPayload: ReviewEditPayload? {
        guard let workspace else { return nil }
        return ReviewEditPayload(
            parentDraftSha256: workspace.draftManifestSha256,
            speakers: speakerDefinitions,
            cues: cues
        )
    }

    func beginLoading() {
        isLoading = true
        statusMessage = "Loading transcript review…"
    }

    func load(_ workspace: ReviewWorkspace) {
        self.workspace = workspace
        speakerDefinitions = workspace.speakers
        cues = workspace.cues
        selectedSpeaker = nil
        mergeSource = speakers.first
        mergeTarget = speakers.dropFirst().first ?? speakers.first
        renameSpeakerID = speakers.first
        isDirty = false
        isLoading = false
        statusMessage = workspace.hasWorkingCopy
            ? "Restored saved working copy"
            : "\(workspace.cues.count.formatted()) cues ready for review"
        audioPlayer.load(URL(fileURLWithPath: workspace.audioPath))
    }

    func unload() {
        workspace = nil
        speakerDefinitions = []
        cues = []
        selectedSpeaker = nil
        mergeSource = nil
        mergeTarget = nil
        renameSpeakerID = nil
        speakerNameDraft = ""
        isDirty = false
        isLoading = false
        statusMessage = "Review is not loaded"
        audioPlayer.stop()
    }

    func addSpeaker(undoManager: UndoManager?) {
        guard let added = ReviewEditing.addSpeaker(to: speakerDefinitions),
              let definition = added.first(where: { candidate in
                  !speakerDefinitions.contains(where: { $0.id == candidate.id })
              })
        else { return }
        apply(
            ReviewSnapshot(speakers: added, cues: cues),
            actionName: "Add Speaker",
            undoManager: undoManager
        )
        selectedSpeaker = definition.id
        renameSpeakerID = definition.id
        if mergeSource == nil { mergeSource = definition.id }
        if mergeTarget == nil { mergeTarget = definition.id }
        statusMessage = "Added \(definition.displayName)"
    }

    func renameSpeaker(undoManager: UndoManager?) {
        guard let renameSpeakerID,
              let renamed = ReviewEditing.renameSpeaker(
                  renameSpeakerID,
                  to: speakerNameDraft,
                  in: speakerDefinitions
              ), renamed != speakerDefinitions
        else { return }
        let normalized = ReviewEditing.normalizedSpeakerDisplayName(speakerNameDraft) ?? speakerNameDraft
        apply(
            ReviewSnapshot(speakers: renamed, cues: cues),
            actionName: "Rename Speaker",
            undoManager: undoManager
        )
        speakerNameDraft = normalized
        statusMessage = "Renamed speaker to \(normalized)"
    }

    func deleteSpeaker(undoManager: UndoManager?) {
        guard let renameSpeakerID,
              let result = ReviewEditing.deleteSpeaker(
                  renameSpeakerID,
                  from: speakerDefinitions,
                  cues: cues
              )
        else { return }
        let name = displayName(renameSpeakerID)
        apply(
            ReviewSnapshot(speakers: result.speakers, cues: result.cues),
            actionName: "Delete Speaker",
            undoManager: undoManager
        )
        selectedSpeaker = result.reassignedCueCount > 0 ? "unknown" : nil
        statusMessage = result.reassignedCueCount == 0
            ? "Deleted \(name)"
            : "Deleted \(name); \(result.reassignedCueCount.formatted()) cue\(result.reassignedCueCount == 1 ? "" : "s") now Unknown"
    }

    func setText(_ text: String, at index: Int) {
        guard cues.indices.contains(index), cues[index].textMarkdown != text else { return }
        cues[index].textMarkdown = text
        markDirty()
    }

    func setSpeaker(_ speaker: String, at index: Int) {
        guard cues.indices.contains(index), cues[index].speakerLabel != speaker else { return }
        cues[index].speakerLabel = speaker
        cues[index].speakerConfirmed = false
        cues[index].speakerAmbiguous = speaker == "unknown"
        markDirty()
    }

    func setConfirmed(_ confirmed: Bool, at index: Int) {
        guard cues.indices.contains(index), cues[index].speakerLabel != "unknown" else { return }
        cues[index].speakerConfirmed = confirmed
        markDirty()
    }

    func confirmAllAssigned(undoManager: UndoManager?) {
        var confirmed = cues
        for index in confirmed.indices where confirmed[index].speakerLabel != "unknown" {
            confirmed[index].speakerConfirmed = true
        }
        apply(confirmed, actionName: "Confirm Speakers", undoManager: undoManager)
    }

    func mergeSpeakers(undoManager: UndoManager?) {
        guard let mergeSource, let mergeTarget, mergeSource != mergeTarget else { return }
        let merged = ReviewEditing.mergeSpeaker(mergeSource, into: mergeTarget, in: cues)
        apply(merged, actionName: "Merge Speakers", undoManager: undoManager)
        selectedSpeaker = nil
        statusMessage = "Merged \(displayName(mergeSource)) into \(displayName(mergeTarget))"
    }

    func mergeNextCue(at index: Int, undoManager: UndoManager?) {
        let merged = ReviewEditing.mergeNext(at: index, in: cues)
        guard merged != cues else { return }
        apply(merged, actionName: "Merge Cues", undoManager: undoManager)
        statusMessage = "Merged cue with the next cue"
    }

    func replaceAll(undoManager: UndoManager?) {
        let result = ReviewEditing.replaceAll(
            findText,
            with: replacementText,
            in: cues,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        )
        guard result.replacements > 0 else { return }
        apply(result.cues, actionName: "Replace Transcript Text", undoManager: undoManager)
        statusMessage = "Replaced \(result.replacements.formatted()) occurrence\(result.replacements == 1 ? "" : "s")"
    }

    func markSaved() {
        isDirty = false
        isLoading = false
        statusMessage = "Working copy saved"
    }

    func markLoadFailed() {
        isLoading = false
        statusMessage = "Transcript review could not be loaded"
    }

    func markApproved() {
        isDirty = false
        isLoading = false
        statusMessage = "Transcript approved"
        audioPlayer.stop()
    }

    func displayName(_ speaker: String) -> String {
        if let definition = speakerDefinitions.first(where: { $0.id == speaker }) {
            return definition.displayName
        }
        guard let suffix = speaker.split(separator: "-").last, let number = Int(suffix) else {
            return speaker == "unknown" ? "Unknown" : speaker
        }
        return "Speaker \(number)"
    }

    private func markDirty() {
        isDirty = true
        statusMessage = "Unsaved edits"
    }

    private struct ReviewSnapshot: Equatable {
        let speakers: [ReviewSpeaker]
        let cues: [ReviewCue]
    }

    private func apply(_ cues: [ReviewCue], actionName: String, undoManager: UndoManager?) {
        apply(
            ReviewSnapshot(speakers: speakerDefinitions, cues: cues),
            actionName: actionName,
            undoManager: undoManager
        )
    }

    private func apply(_ snapshot: ReviewSnapshot, actionName: String, undoManager: UndoManager?) {
        let previous = ReviewSnapshot(speakers: speakerDefinitions, cues: cues)
        guard snapshot != previous else { return }
        speakerDefinitions = snapshot.speakers
        cues = snapshot.cues
        let currentIDs = Set(speakers)
        if let selectedSpeaker, selectedSpeaker != "unknown", !currentIDs.contains(selectedSpeaker) {
            self.selectedSpeaker = nil
        }
        if mergeSource.map({ !currentIDs.contains($0) }) == true { mergeSource = speakers.first }
        if mergeTarget.map({ !currentIDs.contains($0) }) == true {
            mergeTarget = speakers.dropFirst().first ?? speakers.first
        }
        if renameSpeakerID == nil || renameSpeakerID.map({ !currentIDs.contains($0) }) == true {
            renameSpeakerID = speakers.first
        } else if let renameSpeakerID {
            speakerNameDraft = displayName(renameSpeakerID)
        }
        markDirty()
        undoManager?.registerUndo(withTarget: self) { target in
            target.apply(previous, actionName: actionName, undoManager: undoManager)
        }
        undoManager?.setActionName(actionName)
    }
}

import Foundation
import Observation
import PodcastVisualizerCore

@MainActor
@Observable
final class TranscriptReviewStore {
    private(set) var workspace: ReviewWorkspace?
    var cues: [ReviewCue] = []
    var selectedSpeaker: String?
    var mergeSource: String?
    var mergeTarget: String?
    var findText = ""
    var replacementText = ""
    var caseSensitive = false
    var wholeWords = false
    var statusMessage = "Review is not loaded"
    private(set) var isLoading = false
    private(set) var isDirty = false
    let audioPlayer = LocalAudioPlayer()

    var speakers: [String] { workspace?.speakers ?? [] }

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
        !cues.isEmpty && cues.allSatisfy {
            !$0.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && $0.speakerLabel != "unknown" && $0.speakerConfirmed
        }
    }

    var editPayload: ReviewEditPayload? {
        guard let workspace else { return nil }
        return ReviewEditPayload(parentDraftSha256: workspace.draftManifestSha256, cues: cues)
    }

    func beginLoading() {
        isLoading = true
        statusMessage = "Loading transcript review…"
    }

    func load(_ workspace: ReviewWorkspace) {
        self.workspace = workspace
        cues = workspace.cues
        selectedSpeaker = nil
        mergeSource = workspace.speakers.first
        mergeTarget = workspace.speakers.dropFirst().first ?? workspace.speakers.first
        isDirty = false
        isLoading = false
        statusMessage = workspace.hasWorkingCopy
            ? "Restored saved working copy"
            : "\(workspace.cues.count.formatted()) cues ready for review"
        audioPlayer.load(URL(fileURLWithPath: workspace.audioPath))
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
        guard let suffix = speaker.split(separator: "-").last, let number = Int(suffix) else {
            return speaker == "unknown" ? "Unknown" : speaker
        }
        return "Speaker \(number)"
    }

    private func markDirty() {
        isDirty = true
        statusMessage = "Unsaved edits"
    }

    private func apply(_ snapshot: [ReviewCue], actionName: String, undoManager: UndoManager?) {
        guard snapshot != cues else { return }
        let previous = cues
        cues = snapshot
        markDirty()
        undoManager?.registerUndo(withTarget: self) { target in
            target.apply(previous, actionName: actionName, undoManager: undoManager)
        }
        undoManager?.setActionName(actionName)
    }
}

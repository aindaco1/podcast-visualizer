import Foundation
import Observation
import PodcastVisualizerCore

@MainActor
@Observable
final class TranscriptReviewStore {
    private(set) var workspace: ReviewWorkspace?
    private(set) var speakerDefinitions: [ReviewSpeaker] = []
    private(set) var cues: [ReviewCue] = []
    private(set) var checkedCueIDs: Set<ReviewCue.ID> = []
    private(set) var editedCueIDs: Set<ReviewCue.ID> = []
    private(set) var recognitionConfidence: ReviewRecognitionConfidence?
    @ObservationIgnored private var cueIndicesByID: [ReviewCue.ID: Int] = [:]
    @ObservationIgnored private var confidenceTiersByCueID: [ReviewCue.ID: ReviewRecognitionConfidenceTier] = [:]
    var selectedSpeaker: String?
    var selectedConfidenceTiers: Set<ReviewRecognitionConfidenceTier> = []
    var showUncheckedOnly = false
    var mergeSource: String?
    var mergeTarget: String?
    var renameSpeakerID: String?
    var speakerNameDraft = ""
    var findText = "" {
        didSet { refreshMatches(resetSelection: true) }
    }
    var replacementText = ""
    var caseSensitive = false {
        didSet { refreshMatches(resetSelection: true) }
    }
    var wholeWords = false {
        didSet { refreshMatches(resetSelection: true) }
    }
    var statusMessage = "Review is not loaded"
    private(set) var isLoading = false
    private(set) var isDirty = false
    private(set) var searchMatches: [ReviewTextMatch] = []
    private(set) var currentMatchIndex: Int?
    let audioPlayer = LocalAudioPlayer()

    var speakers: [String] { speakerDefinitions.map(\.id) }

    var canAddSpeaker: Bool { speakerDefinitions.count < ReviewSpeaker.maximumCount }

    var canDeleteSpeaker: Bool {
        renameSpeakerID.map { speakers.contains($0) } == true
    }

    var visibleCues: [ReviewCue] {
        cues.filter { cue in
            (selectedSpeaker == nil || cue.speakerLabel == selectedSpeaker)
                && (selectedConfidenceTiers.isEmpty
                    || selectedConfidenceTiers.contains(confidenceTier(for: cue.id)))
                && (!showUncheckedOnly || !checkedCueIDs.contains(cue.id))
        }
    }

    var speakerCounts: [String: Int] {
        Dictionary(grouping: cues, by: \.speakerLabel).mapValues(\.count)
    }

    var confidenceCounts: [ReviewRecognitionConfidenceTier: Int] {
        Dictionary(grouping: cues, by: { confidenceTier(for: $0.id) }).mapValues(\.count)
    }

    var checkedCount: Int { checkedCueIDs.count }

    var replacementPreviewCount: Int { searchMatches.count }

    var currentMatch: ReviewTextMatch? {
        guard let currentMatchIndex, searchMatches.indices.contains(currentMatchIndex)
        else { return nil }
        return searchMatches[currentMatchIndex]
    }

    var matchPosition: String {
        guard let currentMatchIndex, !searchMatches.isEmpty else { return "0 of 0" }
        return "\((currentMatchIndex + 1).formatted()) of \(searchMatches.count.formatted())"
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

    func editPayload(
        reflowBoundaryHints: [ReviewReflowBoundaryHint] = []
    ) -> ReviewEditPayload? {
        guard let workspace else { return nil }
        return ReviewEditPayload(
            parentDraftSha256: workspace.draftManifestSha256,
            baseTranscriptId: workspace.baseTranscriptId,
            baseRevisionSha256: workspace.baseRevisionSha256,
            speakers: speakerDefinitions,
            cues: cues,
            reflowBoundaryHints: reflowBoundaryHints,
            checkedCueIds: cues.compactMap { checkedCueIDs.contains($0.id) ? $0.id : nil }
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
        checkedCueIDs = Set(workspace.checkedCueIds)
        editedCueIDs = Set(workspace.editedCueIds)
        recognitionConfidence = workspace.recognitionConfidence
        rebuildCueIndices()
        rebuildConfidenceIndex()
        selectedSpeaker = nil
        selectedConfidenceTiers = []
        showUncheckedOnly = false
        mergeSource = speakers.first
        mergeTarget = speakers.dropFirst().first ?? speakers.first
        renameSpeakerID = speakers.first
        speakerNameDraft = renameSpeakerID.map(displayName) ?? ""
        isDirty = false
        isLoading = false
        statusMessage = workspace.hasWorkingCopy
            ? "Restored saved working copy"
            : "\(workspace.cues.count.formatted()) cues ready for review"
        audioPlayer.load(URL(fileURLWithPath: workspace.audioPath))
        refreshMatches(resetSelection: true)
    }

    func unload() {
        workspace = nil
        speakerDefinitions = []
        cues = []
        checkedCueIDs = []
        editedCueIDs = []
        recognitionConfidence = nil
        cueIndicesByID = [:]
        confidenceTiersByCueID = [:]
        selectedSpeaker = nil
        selectedConfidenceTiers = []
        showUncheckedOnly = false
        mergeSource = nil
        mergeTarget = nil
        renameSpeakerID = nil
        speakerNameDraft = ""
        searchMatches = []
        currentMatchIndex = nil
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
            ReviewSnapshot(
                speakers: added,
                cues: cues,
                checkedCueIDs: checkedCueIDs,
                recognitionConfidence: recognitionConfidence
            ),
            actionName: "Add Speaker",
            undoManager: undoManager
        )
        selectedSpeaker = definition.id
        renameSpeakerID = definition.id
        speakerNameDraft = definition.displayName
        if mergeSource == nil { mergeSource = definition.id }
        if mergeTarget == nil { mergeTarget = definition.id }
        statusMessage = "Added \(definition.displayName)"
    }

    @discardableResult
    func commitSpeakerRename(undoManager: UndoManager?) -> Bool {
        guard let renameSpeakerID else { return false }
        let priorName = displayName(renameSpeakerID)
        guard let normalized = ReviewEditing.normalizedSpeakerDisplayName(speakerNameDraft) else {
            speakerNameDraft = priorName
            statusMessage = "Speaker name wasn't changed. Enter 1–60 visible characters; \(priorName) was preserved."
            return false
        }
        guard normalized != priorName else {
            speakerNameDraft = priorName
            return true
        }
        guard let renamed = ReviewEditing.renameSpeaker(
            renameSpeakerID,
            to: normalized,
            in: speakerDefinitions
        ) else {
            speakerNameDraft = priorName
            statusMessage = "Speaker name wasn't changed. \(priorName) was preserved."
            return false
        }
        apply(
            ReviewSnapshot(
                speakers: renamed,
                cues: cues,
                checkedCueIDs: checkedCueIDs,
                recognitionConfidence: recognitionConfidence
            ),
            actionName: "Rename Speaker",
            undoManager: undoManager
        )
        speakerNameDraft = normalized
        statusMessage = "Renamed speaker to \(normalized)"
        return true
    }

    func selectRenameSpeaker(_ speakerID: String?, undoManager: UndoManager?) {
        guard speakerID != renameSpeakerID else { return }
        _ = commitSpeakerRename(undoManager: undoManager)
        renameSpeakerID = speakerID
        speakerNameDraft = speakerID.map(displayName) ?? ""
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
            ReviewSnapshot(
                speakers: result.speakers,
                cues: result.cues,
                checkedCueIDs: checkedCueIDs,
                recognitionConfidence: recognitionConfidence
            ),
            actionName: "Delete Speaker",
            undoManager: undoManager
        )
        selectedSpeaker = result.reassignedCueCount > 0 ? "unknown" : nil
        statusMessage = result.reassignedCueCount == 0
            ? "Deleted \(name)"
            : "Deleted \(name); \(result.reassignedCueCount.formatted()) cue\(result.reassignedCueCount == 1 ? "" : "s") now Unknown"
    }

    func cue(withID cueID: ReviewCue.ID) -> ReviewCue? {
        guard let index = cueIndex(for: cueID) else { return nil }
        return cues[index]
    }

    func canMergeNext(cueID: ReviewCue.ID) -> Bool {
        guard let index = cueIndex(for: cueID) else { return false }
        return cues.indices.contains(index + 1)
    }

    func canMergePrevious(cueID: ReviewCue.ID) -> Bool {
        guard let index = cueIndex(for: cueID) else { return false }
        return index > 0
    }

    func confidenceTier(for cueID: ReviewCue.ID) -> ReviewRecognitionConfidenceTier {
        confidenceTiersByCueID[cueID] ?? .unavailable
    }

    func isChecked(_ cueID: ReviewCue.ID) -> Bool {
        checkedCueIDs.contains(cueID)
    }

    func isEdited(_ cueID: ReviewCue.ID) -> Bool {
        editedCueIDs.contains(cueID)
    }

    func toggleConfidenceTier(_ tier: ReviewRecognitionConfidenceTier) {
        if selectedConfidenceTiers.isEmpty {
            selectedConfidenceTiers = [tier]
        } else if selectedConfidenceTiers.contains(tier) {
            selectedConfidenceTiers.remove(tier)
        } else {
            selectedConfidenceTiers.insert(tier)
        }
    }

    func clearConfidenceFilter() {
        selectedConfidenceTiers = []
    }

    func setChecked(_ checked: Bool, for cueID: ReviewCue.ID, undoManager: UndoManager?) {
        guard cueIndex(for: cueID) != nil, checkedCueIDs.contains(cueID) != checked else { return }
        var updated = checkedCueIDs
        if checked { updated.insert(cueID) }
        else { updated.remove(cueID) }
        apply(
            ReviewSnapshot(
                speakers: speakerDefinitions,
                cues: cues,
                checkedCueIDs: updated,
                recognitionConfidence: recognitionConfidence
            ),
            actionName: checked ? "Check Transcript Cue" : "Uncheck Transcript Cue",
            undoManager: undoManager
        )
        statusMessage = checked ? "Marked cue Checked" : "Marked cue Unchecked"
    }

    func setText(_ text: String, for cueID: ReviewCue.ID) {
        guard let index = cueIndex(for: cueID), cues[index].textMarkdown != text else { return }
        cues[index].textMarkdown = text
        checkedCueIDs.remove(cueID)
        refreshEditedState(forCueAt: index)
        markDirty()
        refreshMatches(forCueAt: index)
    }

    func setSpeaker(_ speaker: String, for cueID: ReviewCue.ID) {
        guard let index = cueIndex(for: cueID), cues[index].speakerLabel != speaker else { return }
        cues[index].speakerLabel = speaker
        cues[index].speakerConfirmed = false
        cues[index].speakerAmbiguous = speaker == "unknown"
        markDirty()
    }

    func setConfirmed(_ confirmed: Bool, for cueID: ReviewCue.ID) {
        guard let index = cueIndex(for: cueID), cues[index].speakerLabel != "unknown" else { return }
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

    func mergeNextCue(cueID: ReviewCue.ID, undoManager: UndoManager?) {
        guard let index = cueIndex(for: cueID), cues.indices.contains(index + 1) else { return }
        let rightCueID = cues[index + 1].id
        let merged = ReviewEditing.mergeNext(cueID: cueID, in: cues)
        guard merged != cues else { return }
        var checked = checkedCueIDs
        checked.remove(cueID)
        checked.remove(rightCueID)
        apply(
            ReviewSnapshot(
                speakers: speakerDefinitions,
                cues: merged,
                checkedCueIDs: checked,
                recognitionConfidence: recognitionConfidence?.merging(
                    leftCueID: cueID,
                    rightCueID: rightCueID
                )
            ),
            actionName: "Merge Cues",
            undoManager: undoManager
        )
        statusMessage = "Merged cue with the next cue"
    }

    func mergePreviousCue(cueID: ReviewCue.ID, undoManager: UndoManager?) {
        guard let index = cueIndex(for: cueID), index > 0 else { return }
        let leftCueID = cues[index - 1].id
        let merged = ReviewEditing.mergePrevious(cueID: cueID, in: cues)
        guard merged != cues else { return }
        var checked = checkedCueIDs
        checked.remove(leftCueID)
        checked.remove(cueID)
        apply(
            ReviewSnapshot(
                speakers: speakerDefinitions,
                cues: merged,
                checkedCueIDs: checked,
                recognitionConfidence: recognitionConfidence?.merging(
                    leftCueID: leftCueID,
                    rightCueID: cueID
                )
            ),
            actionName: "Merge Cues",
            undoManager: undoManager
        )
        statusMessage = "Merged cue with the previous cue"
    }

    func splitCue(
        cueID: ReviewCue.ID,
        textBoundaryUTF16Offset: Int?,
        playheadMs suppliedPlayheadMs: Int? = nil,
        undoManager: UndoManager?
    ) {
        guard let textBoundaryUTF16Offset else {
            statusMessage = "Split wasn't applied. Place the text caret between words; the cue was preserved."
            return
        }
        let playheadMs = suppliedPlayheadMs
            ?? Int((audioPlayer.currentTime * 1_000).rounded())
        switch ReviewEditing.splitCue(
            cueID: cueID,
            at: playheadMs,
            textBoundaryUTF16Offset: textBoundaryUTF16Offset,
            in: cues
        ) {
        case .success(let result):
            var checked = checkedCueIDs
            checked.remove(cueID)
            checked.remove(result.rightCueID)
            apply(
                ReviewSnapshot(
                    speakers: speakerDefinitions,
                    cues: result.cues,
                    checkedCueIDs: checked,
                    recognitionConfidence: recognitionConfidence?.splitting(
                        cueID: result.leftCueID,
                        rightCueID: result.rightCueID,
                        at: playheadMs
                    )
                ),
                actionName: "Split Cue",
                undoManager: undoManager
            )
            statusMessage = "Split cue at the playhead; both cues are Unchecked"
        case .failure(.cueMissing):
            statusMessage = "Split wasn't applied because the cue changed. Try again; all edits were preserved."
        case .failure(.cueLimitReached):
            statusMessage = "Split wasn't applied because the 10,000-cue limit was reached. All cues were preserved."
        case .failure(.cueIdentityExhausted):
            statusMessage = "Split wasn't applied because no safe cue identity remained. All cues were preserved."
        case .failure(.unsafePlayhead):
            statusMessage = "Split wasn't applied. Move the playhead at least 0.15 seconds from both cue edges; the cue was preserved."
        case .failure(.invalidTextBoundary):
            statusMessage = "Split wasn't applied. Place the text caret between two words; the cue was preserved."
        }
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

    func selectNextMatch() {
        selectMatch(direction: 1)
    }

    func selectPreviousMatch() {
        selectMatch(direction: -1)
    }

    func replaceCurrent(undoManager: UndoManager?) {
        guard let descriptor = currentMatch else { return }
        let result = ReviewEditing.replace(
            descriptor,
            search: findText,
            with: replacementText,
            in: cues,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        )
        guard result.replacements == 1 else {
            refreshMatches()
            return
        }
        apply(result.cues, actionName: "Replace Transcript Match", undoManager: undoManager)
        selectMatch(after: descriptor, replacementUTF16Length: replacementText.utf16.count)
        statusMessage = "Replaced selected occurrence"
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
        workspace = nil
        speakerDefinitions = []
        cues = []
        checkedCueIDs = []
        editedCueIDs = []
        recognitionConfidence = nil
        cueIndicesByID = [:]
        confidenceTiersByCueID = [:]
        selectedSpeaker = nil
        selectedConfidenceTiers = []
        showUncheckedOnly = false
        mergeSource = nil
        mergeTarget = nil
        renameSpeakerID = nil
        speakerNameDraft = ""
        searchMatches = []
        currentMatchIndex = nil
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

    private func cueIndex(for cueID: ReviewCue.ID) -> Int? {
        guard let index = cueIndicesByID[cueID], cues.indices.contains(index), cues[index].id == cueID
        else { return nil }
        return index
    }

    private func rebuildCueIndices() {
        cueIndicesByID = Dictionary(uniqueKeysWithValues: cues.enumerated().map { ($1.id, $0) })
    }

    private func rebuildConfidenceIndex() {
        confidenceTiersByCueID = Dictionary(uniqueKeysWithValues:
            (recognitionConfidence?.cues ?? []).map { ($0.cueId, $0.tier) }
        )
    }

    private func refreshEditedState(forCueAt index: Int) {
        guard cues.indices.contains(index) else { return }
        let cue = cues[index]
        let baseline = workspace?.cues.first(where: { $0.id == cue.id })
        let wasEdited = workspace?.editedCueIds.contains(cue.id) == true
        if wasEdited || baseline == nil
            || baseline?.startsAtMs != cue.startsAtMs
            || baseline?.endsAtMs != cue.endsAtMs
            || baseline?.textMarkdown != cue.textMarkdown {
            editedCueIDs.insert(cue.id)
        } else {
            editedCueIDs.remove(cue.id)
        }
    }

    private func rebuildEditedState() {
        editedCueIDs = []
        for index in cues.indices { refreshEditedState(forCueAt: index) }
    }

    private struct ReviewSnapshot: Equatable {
        let speakers: [ReviewSpeaker]
        let cues: [ReviewCue]
        let checkedCueIDs: Set<ReviewCue.ID>
        let recognitionConfidence: ReviewRecognitionConfidence?

        init(
            speakers: [ReviewSpeaker],
            cues: [ReviewCue],
            checkedCueIDs: Set<ReviewCue.ID> = [],
            recognitionConfidence: ReviewRecognitionConfidence? = nil
        ) {
            self.speakers = speakers
            self.cues = cues
            self.checkedCueIDs = checkedCueIDs
            self.recognitionConfidence = recognitionConfidence
        }
    }

    private func apply(_ cues: [ReviewCue], actionName: String, undoManager: UndoManager?) {
        let priorByID = Dictionary(uniqueKeysWithValues: self.cues.map { ($0.id, $0) })
        let retainedChecked = Set(cues.compactMap { cue -> ReviewCue.ID? in
            guard checkedCueIDs.contains(cue.id),
                  let prior = priorByID[cue.id],
                  prior.startsAtMs == cue.startsAtMs,
                  prior.endsAtMs == cue.endsAtMs,
                  prior.textMarkdown == cue.textMarkdown
            else { return nil }
            return cue.id
        })
        apply(
            ReviewSnapshot(
                speakers: speakerDefinitions,
                cues: cues,
                checkedCueIDs: retainedChecked,
                recognitionConfidence: recognitionConfidence
            ),
            actionName: actionName,
            undoManager: undoManager
        )
    }

    private func apply(_ snapshot: ReviewSnapshot, actionName: String, undoManager: UndoManager?) {
        let previous = ReviewSnapshot(
            speakers: speakerDefinitions,
            cues: cues,
            checkedCueIDs: checkedCueIDs,
            recognitionConfidence: recognitionConfidence
        )
        guard snapshot != previous else { return }
        let textChanged = snapshot.cues.count != previous.cues.count
            || zip(snapshot.cues, previous.cues).contains { pair in
                pair.0.id != pair.1.id || pair.0.textMarkdown != pair.1.textMarkdown
            }
        speakerDefinitions = snapshot.speakers
        cues = snapshot.cues
        checkedCueIDs = snapshot.checkedCueIDs
        recognitionConfidence = snapshot.recognitionConfidence
        rebuildCueIndices()
        rebuildConfidenceIndex()
        rebuildEditedState()
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
        }
        if let renameSpeakerID {
            speakerNameDraft = displayName(renameSpeakerID)
        } else {
            speakerNameDraft = ""
        }
        markDirty()
        if textChanged { refreshMatches() }
        undoManager?.registerUndo(withTarget: self) { target in
            target.apply(previous, actionName: actionName, undoManager: undoManager)
        }
        undoManager?.setActionName(actionName)
    }

    private func selectMatch(direction: Int) {
        currentMatchIndex = ReviewEditing.navigatedMatchIndex(
            current: currentMatchIndex,
            count: searchMatches.count,
            direction: direction
        )
        if currentMatchIndex != nil {
            selectedSpeaker = nil
            selectedConfidenceTiers = []
            showUncheckedOnly = false
        }
    }

    private func refreshMatches(resetSelection: Bool = false) {
        let priorID = resetSelection ? nil : currentMatch?.id
        let priorIndex = resetSelection ? nil : currentMatchIndex
        searchMatches = ReviewEditing.matches(
            findText,
            in: cues,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        )
        guard !searchMatches.isEmpty else {
            currentMatchIndex = nil
            return
        }
        if resetSelection {
            selectedSpeaker = nil
            selectedConfidenceTiers = []
            showUncheckedOnly = false
        }
        if let priorID, let retained = searchMatches.firstIndex(where: { $0.id == priorID }) {
            currentMatchIndex = retained
        } else {
            currentMatchIndex = min(priorIndex ?? 0, searchMatches.count - 1)
        }
    }

    private func refreshMatches(forCueAt index: Int) {
        guard cues.indices.contains(index), !findText.isEmpty else {
            refreshMatches()
            return
        }
        let priorIndex = currentMatchIndex
        let cueID = cues[index].id
        let replacements = ReviewEditing.matches(
            findText,
            in: [cues[index]],
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        )
        var rebuilt: [ReviewTextMatch] = []
        rebuilt.reserveCapacity(searchMatches.count + replacements.count)
        var inserted = false
        let cueOrder = Dictionary(uniqueKeysWithValues: cues.enumerated().map { ($1.id, $0) })
        for match in searchMatches where match.cueID != cueID {
            if !inserted, (cueOrder[match.cueID] ?? Int.max) > index {
                rebuilt.append(contentsOf: replacements)
                inserted = true
            }
            rebuilt.append(match)
        }
        if !inserted { rebuilt.append(contentsOf: replacements) }
        searchMatches = rebuilt
        currentMatchIndex = searchMatches.isEmpty
            ? nil
            : min(priorIndex ?? 0, searchMatches.count - 1)
    }

    private func selectMatch(after replaced: ReviewTextMatch, replacementUTF16Length: Int) {
        guard !searchMatches.isEmpty else {
            currentMatchIndex = nil
            return
        }
        let cueOrder = Dictionary(uniqueKeysWithValues: cues.enumerated().map { ($1.id, $0) })
        let replacedCueOrder = cueOrder[replaced.cueID] ?? -1
        let minimumLocation = replaced.utf16Location + replacementUTF16Length
        currentMatchIndex = searchMatches.firstIndex { match in
            let order = cueOrder[match.cueID] ?? Int.max
            return order > replacedCueOrder
                || (order == replacedCueOrder && match.utf16Location >= minimumLocation)
        } ?? 0
        selectedSpeaker = nil
        selectedConfidenceTiers = []
        showUncheckedOnly = false
    }
}

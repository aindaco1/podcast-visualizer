import Foundation
import Observation
import PodcastVisualizerCore

@MainActor
@Observable
final class ChapterReviewStore {
    private(set) var workspace: ChapterWorkspace?
    private(set) var entries: [ChapterEntry] = []
    var mode: ChapterMode = .topics
    var statusMessage = "Chapters are not loaded"
    private(set) var isLoading = false
    private(set) var isDirty = false
    private(set) var hasApproval = false
    private(set) var lastExport: ChapterExportResult?

    var records: [ChapterContextRecord] {
        workspace?.contextArtifact.context.windows.flatMap(\.records) ?? []
    }

    var unusedRecords: [ChapterContextRecord] {
        let used = Set(entries.map(\.anchorId))
        return records.filter { !used.contains($0.anchorId) }
    }

    var canApprove: Bool {
        guard let context = workspace?.contextArtifact.context,
              (3...context.policy.maximumChapters).contains(entries.count)
        else { return false }
        let recordsByID = Dictionary(uniqueKeysWithValues: records.map { ($0.anchorId, $0) })
        let sorted = entries.compactMap { entry in recordsByID[entry.anchorId].map { ($0, entry) } }
            .sorted { $0.0.startsAtMs < $1.0.startsAtMs }
        guard sorted.count == entries.count, sorted.first?.0.startsAtMs == 0,
              Set(entries.map(\.anchorId)).count == entries.count
        else { return false }
        var previousStart: Int?
        for (record, entry) in sorted {
            guard validTitle(
                entry.title,
                maximum: context.policy.maximumTitleCharacters
            ),
                  previousStart.map({
                    record.startsAtMs - $0 >= context.policy.minimumChapterDurationMs
                  }) ?? true,
                  context.durationMs - record.startsAtMs >= context.policy.minimumChapterDurationMs
            else { return false }
            previousStart = record.startsAtMs
        }
        return true
    }

    func beginLoading() {
        isLoading = true
        statusMessage = "Loading aligned chapter context…"
    }

    func load(_ workspace: ChapterWorkspace) {
        self.workspace = workspace
        mode = workspace.contextArtifact.mode
        if workspace.edit.entries.isEmpty, let approved = workspace.approved {
            entries = approved.list.chapters.map {
                ChapterEntry(anchorId: $0.anchorId, title: $0.title)
            }
        } else {
            entries = workspace.edit.entries
        }
        sortEntries()
        isLoading = false
        isDirty = false
        hasApproval = workspace.approved != nil
        lastExport = nil
        statusMessage = workspace.approved == nil
            ? "\(entries.count.formatted()) chapter entries ready for review"
            : "Approved chapters loaded"
    }

    func unload() {
        workspace = nil
        entries = []
        isLoading = false
        isDirty = false
        hasApproval = false
        lastExport = nil
        statusMessage = "Chapters are not loaded"
    }

    func markLoadFailed() {
        isLoading = false
        statusMessage = "Chapters could not be loaded. Existing chapter drafts were preserved."
    }

    func applyAdvice(_ advice: ChapterAdvice) {
        guard !advice.entries.isEmpty else {
            statusMessage = "The on-device model did not return grounded suggestions. Add chapters manually."
            return
        }
        entries = advice.entries
        sortEntries()
        isDirty = true
        hasApproval = false
        statusMessage = advice.usedOnDeviceModel
            ? "Generated \(entries.count.formatted()) grounded suggestions for review"
            : "Loaded deterministic chapter suggestions"
    }

    func add(_ record: ChapterContextRecord) {
        guard !entries.contains(where: { $0.anchorId == record.anchorId }) else { return }
        entries.append(ChapterEntry(anchorId: record.anchorId, title: ""))
        sortEntries()
        isDirty = true
        hasApproval = false
        statusMessage = "Added a chapter start; enter a title"
    }

    func remove(anchorId: String) {
        entries.removeAll { $0.anchorId == anchorId }
        isDirty = true
        hasApproval = false
        statusMessage = "Removed chapter entry"
    }

    func updateTitle(anchorId: String, title: String) {
        guard let index = entries.firstIndex(where: { $0.anchorId == anchorId }) else { return }
        entries[index].title = String(title.prefix(
            workspace?.contextArtifact.context.policy.maximumTitleCharacters ?? 100
        ))
        isDirty = true
        hasApproval = false
    }

    func replaceAnchor(_ anchorId: String, with record: ChapterContextRecord) {
        guard !entries.contains(where: { $0.anchorId == record.anchorId }),
              let index = entries.firstIndex(where: { $0.anchorId == anchorId })
        else { return }
        let title = entries[index].title
        entries[index] = ChapterEntry(anchorId: record.anchorId, title: title)
        sortEntries()
        isDirty = true
        hasApproval = false
    }

    func editPayload() -> ChapterEditPayload? {
        workspace.map { ChapterEditPayload(context: $0.contextArtifact, entries: entries) }
    }

    func markSaved() {
        isDirty = false
        statusMessage = "Chapter working copy saved"
    }

    func markApproved(_ result: ChapterApprovalResult) {
        isDirty = false
        hasApproval = true
        statusMessage = "Approved \(result.chapters.formatted()) chapters"
    }

    func markExported(_ result: ChapterExportResult) {
        lastExport = result
        statusMessage = "Exported \(result.format) chapters"
    }

    func timestamp(for anchorId: String) -> String {
        guard let milliseconds = records.first(where: { $0.anchorId == anchorId })?.startsAtMs
        else { return "--:--" }
        let seconds = milliseconds / 1_000
        let hours = seconds / 3_600
        let minutes = seconds / 60 % 60
        let remainder = seconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
            : String(format: "%02d:%02d", minutes, remainder)
    }

    private func sortEntries() {
        let starts = Dictionary(uniqueKeysWithValues: records.map { ($0.anchorId, $0.startsAtMs) })
        entries.sort { starts[$0.anchorId, default: .max] < starts[$1.anchorId, default: .max] }
    }

    private func validTitle(_ value: String, maximum: Int) -> Bool {
        let collapsed = value
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return !value.isEmpty && value == collapsed && value.count <= maximum
            && value.precomposedStringWithCanonicalMapping == value
            && value.rangeOfCharacter(from: .controlCharacters) == nil
            && value.range(
                of: #"[\u{202A}-\u{202E}\u{2066}-\u{2069}]"#,
                options: .regularExpression
            ) == nil
    }
}

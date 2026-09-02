import AppKit
import Foundation
import PodcastVisualizerCore
import SwiftUI
import Testing
@testable import PodcastVisualizerApp

@Suite("Transcript review store")
@MainActor
struct TranscriptReviewStoreTests {
    // SwiftUI can enqueue AppKit display work after a snapshot is captured.
    // Retaining these hidden windows avoids tearing down their view trees mid-pass.
    private static var retainedRenderWindows: [NSWindow] = []

    private final class NoopUpdateChecker: UpdateChecking {
        let canCheckForUpdates = true
        func checkForUpdates() {}
    }

    private func workspace() -> ReviewWorkspace {
        let confidence = ReviewRecognitionConfidence(
            thresholds: ReviewRecognitionConfidenceThresholds(
                ultraLowBelow: 0.5,
                lowBelow: 0.9,
                mediumBelow: 0.98
            ),
            cues: [
                ReviewCueRecognitionConfidence(
                    cueId: "cue_000001", tier: .low, score: 0.7, tokenCount: 2,
                    tokenEvidence: [
                        ReviewRecognitionTokenEvidence(startsAtMs: 100, endsAtMs: 300, score: 0.7),
                        ReviewRecognitionTokenEvidence(startsAtMs: 700, endsAtMs: 900, score: 0.99),
                    ]
                ),
                ReviewCueRecognitionConfidence(
                    cueId: "cue_000002", tier: .high, score: 0.99, tokenCount: 1,
                    tokenEvidence: [
                        ReviewRecognitionTokenEvidence(startsAtMs: 1_300, endsAtMs: 1_600, score: 0.99),
                    ]
                ),
            ]
        )
        return ReviewWorkspace(
            projectRoot: "/Users/example/project",
            draftManifestSha256: String(repeating: "a", count: 64),
            audioPath: "/Users/example/project/source/review.wav",
            durationMs: 2_200,
            speakers: [ReviewSpeaker(id: "speaker-01", displayName: "Speaker 1")],
            cues: [
                ReviewCue(
                    id: "cue_000001", startsAtMs: 0, endsAtMs: 1_000,
                    textMarkdown: "First cue.", speakerLabel: "speaker-01",
                    speakerConfirmed: true, speakerConfidence: 1, speakerAmbiguous: false
                ),
                ReviewCue(
                    id: "cue_000002", startsAtMs: 1_200, endsAtMs: 2_200,
                    textMarkdown: "Second cue.", speakerLabel: "speaker-01",
                    speakerConfirmed: true, speakerConfidence: 1, speakerAmbiguous: false
                ),
            ],
            recognitionConfidence: confidence,
            hasWorkingCopy: true
        )
    }

    @Test("approval teardown makes retained row actions safe no-ops")
    func approvalTeardown() {
        let cueID = "cue_000001"
        let store = TranscriptReviewStore()
        store.load(workspace())
        #expect(store.cue(withID: cueID)?.textMarkdown == "First cue.")

        store.markApproved()

        #expect(store.workspace == nil)
        #expect(store.cues.isEmpty)
        #expect(store.cue(withID: cueID) == nil)
        #expect(!store.canMergeNext(cueID: cueID))
        store.setText("Stale edit", for: cueID)
        store.setSpeaker("unknown", for: cueID)
        store.setConfirmed(false, for: cueID)
        store.mergeNextCue(cueID: cueID, undoManager: nil)
        #expect(store.cues.isEmpty)
        #expect(store.statusMessage == "Transcript approved")
    }

    @Test("SwiftUI can reconcile visible transcript rows while approval clears the review")
    func approvalViewTeardown() throws {
        _ = NSApplication.shared
        let appStore = AppStore(
            client: DemoCLIClient(),
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false")),
            updateChecker: NoopUpdateChecker(),
            brand: nil
        )
        appStore.transcriptReview.load(workspace())
        appStore.selectedTab = .transcriptReview
        let host = NSHostingView(rootView: MainWindow(store: appStore))
        host.frame = NSRect(x: 0, y: 0, width: 1_040, height: 780)
        host.layoutSubtreeIfNeeded()

        appStore.selectedTab = .project
        appStore.transcriptReview.markApproved()
        host.layoutSubtreeIfNeeded()

        #expect(appStore.transcriptReview.workspace == nil)
        #expect(appStore.transcriptReview.cues.isEmpty)
    }

    @Test("transcript review renders its sidebar")
    func visibleSidebarLayout() throws {
        _ = NSApplication.shared
        let appStore = AppStore(
            client: DemoCLIClient(),
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false")),
            updateChecker: NoopUpdateChecker(),
            brand: nil
        )
        appStore.transcriptReview.load(workspace())

        let sidebar = NSRect(x: 8, y: 72, width: 230, height: 620)
        let sidebarContrast = try renderedReviewContrast(
            appStore: appStore,
            visibility: .all,
            region: sidebar
        )
        #expect(sidebarContrast > 24)
    }

    @Test("transcript review detail remains rendered with its sidebar hidden")
    func hiddenSidebarLayout() throws {
        _ = NSApplication.shared
        let appStore = AppStore(
            client: DemoCLIClient(),
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false")),
            updateChecker: NoopUpdateChecker(),
            brand: nil
        )
        appStore.transcriptReview.load(workspace())
        let detail = NSRect(x: 80, y: 72, width: 920, height: 620)
        let detailContrast = try renderedReviewContrast(
            appStore: appStore,
            visibility: .detailOnly,
            region: detail
        )
        #expect(detailContrast > 24)
    }

    @Test("composes confidence and checked filters without reordering cues")
    func confidenceAndCheckedFilters() {
        let store = TranscriptReviewStore()
        let undoManager = UndoManager()
        store.load(workspace())

        store.toggleConfidenceTier(.low)
        #expect(store.visibleCues.map(\.id) == ["cue_000001"])
        store.toggleConfidenceTier(.high)
        #expect(store.visibleCues.map(\.id) == ["cue_000001", "cue_000002"])

        store.setChecked(true, for: "cue_000001", undoManager: undoManager)
        store.showUncheckedOnly = true
        #expect(store.visibleCues.map(\.id) == ["cue_000002"])
        #expect(store.editPayload()?.checkedCueIds == ["cue_000001"])
        undoManager.undo()
        #expect(store.checkedCount == 0)
    }

    @Test("filters ten thousand confidence cues in one bounded pass")
    func maximumConfidenceFilter() {
        let cues = (1...10_000).map { index in
            ReviewCue(
                id: "cue_\(String(format: "%06d", index))",
                startsAtMs: (index - 1) * 10,
                endsAtMs: index * 10,
                textMarkdown: "Bounded cue \(index).",
                speakerLabel: "speaker-01",
                speakerConfirmed: true,
                speakerConfidence: 1,
                speakerAmbiguous: false
            )
        }
        let confidence = ReviewRecognitionConfidence(
            thresholds: ReviewRecognitionConfidenceThresholds(
                ultraLowBelow: 0.5,
                lowBelow: 0.9,
                mediumBelow: 0.98
            ),
            cues: cues.enumerated().map { index, cue in
                let tier: ReviewRecognitionConfidenceTier = index.isMultiple(of: 2) ? .low : .high
                let score = tier == .low ? 0.7 : 0.99
                return ReviewCueRecognitionConfidence(
                    cueId: cue.id,
                    tier: tier,
                    score: score,
                    tokenCount: 0,
                    tokenEvidence: []
                )
            }
        )
        let largeWorkspace = ReviewWorkspace(
            projectRoot: "/Users/example/project",
            draftManifestSha256: String(repeating: "a", count: 64),
            audioPath: "/Users/example/project/source/review.wav",
            durationMs: 100_000,
            speakers: [ReviewSpeaker(id: "speaker-01", displayName: "Speaker 1")],
            cues: cues,
            recognitionConfidence: confidence,
            hasWorkingCopy: false
        )
        let store = TranscriptReviewStore()
        store.load(largeWorkspace)
        store.toggleConfidenceTier(.low)
        #expect(store.visibleCues.count == 5_000)
        #expect(store.confidenceCounts[.low] == 5_000)
        #expect(store.visibleCues.first?.id == "cue_000001")
        #expect(store.visibleCues.last?.id == "cue_009999")
    }

    @Test("text editing explicitly invalidates prior checked state")
    func editingUnchecksCue() {
        let store = TranscriptReviewStore()
        store.load(workspace())
        store.setChecked(true, for: "cue_000001", undoManager: nil)
        store.setText("Corrected first cue.", for: "cue_000001")
        #expect(!store.isChecked("cue_000001"))
        #expect(store.isEdited("cue_000001"))
        #expect(store.confidenceTier(for: "cue_000001") == .low)
    }

    private func renderedLuminanceRange(of view: NSView, in rect: NSRect) throws -> Int {
        view.window?.displayIfNeeded()
        view.displayIfNeeded()
        let bounds = view.bounds.intersection(rect)
        let pdf = view.dataWithPDF(inside: bounds)
        let image = try #require(NSImage(data: pdf))
        let tiff = try #require(image.tiffRepresentation)
        let representation = try #require(NSBitmapImageRep(data: tiff))
        var minimum = 255
        var maximum = 0
        for y in stride(from: 0, to: representation.pixelsHigh, by: 4) {
            for x in stride(from: 0, to: representation.pixelsWide, by: 4) {
                guard let color = representation.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
                    continue
                }
                let luminance = Int(
                    (color.redComponent * 54 + color.greenComponent * 183 + color.blueComponent * 19)
                        * 255 / 256
                )
                minimum = min(minimum, luminance)
                maximum = max(maximum, luminance)
            }
        }
        return maximum - minimum
    }

    private func renderedReviewContrast(
        appStore: AppStore,
        visibility: NavigationSplitViewVisibility,
        region: NSRect
    ) throws -> Int {
        let host = NSHostingView(rootView: TranscriptReviewView(
            appStore: appStore,
            review: appStore.transcriptReview,
            columnVisibility: .constant(visibility)
        ))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_040, height: 780),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        host.frame = NSRect(x: 0, y: 0, width: 1_040, height: 780)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: 100, y: 100))
        window.orderBack(nil)
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        window.layoutIfNeeded()
        host.layoutSubtreeIfNeeded()

        let contrast = try renderedLuminanceRange(of: host, in: region)
        window.orderOut(nil)
        Self.retainedRenderWindows.append(window)
        return contrast
    }

    @Test("splits and rejoins cues with checked and confidence evidence")
    func splitAndMergeCues() throws {
        let store = TranscriptReviewStore()
        let splitUndoManager = UndoManager()
        store.load(workspace())
        store.setChecked(true, for: "cue_000001", undoManager: nil)
        let text = try #require(store.cue(withID: "cue_000001")?.textMarkdown)
        let boundary = try #require(text.range(of: " cue")?.lowerBound)

        splitUndoManager.beginUndoGrouping()
        store.splitCue(
            cueID: "cue_000001",
            textBoundaryUTF16Offset: boundary.utf16Offset(in: text),
            playheadMs: 500,
            undoManager: splitUndoManager
        )
        splitUndoManager.endUndoGrouping()
        #expect(store.cues.map(\.id) == ["cue_000001", "cue_000003", "cue_000002"])
        #expect(store.checkedCount == 0)
        #expect(store.confidenceTier(for: "cue_000001") == .low)
        #expect(store.confidenceTier(for: "cue_000003") == .high)
        #expect(store.editPayload()?.checkedCueIds == [])

        let mergeUndoManager = UndoManager()
        mergeUndoManager.beginUndoGrouping()
        store.mergePreviousCue(cueID: "cue_000003", undoManager: mergeUndoManager)
        mergeUndoManager.endUndoGrouping()
        #expect(store.cues.map(\.id) == ["cue_000001", "cue_000002"])
        #expect(store.confidenceTier(for: "cue_000001") == .low)
        mergeUndoManager.undo()
        #expect(store.cues.count == 3)
        mergeUndoManager.redo()
        #expect(store.cues.count == 2)
    }

    @Test("split failures explain recovery and preserve the cue")
    func splitFailurePresentation() {
        let store = TranscriptReviewStore()
        store.load(workspace())
        let before = store.cues
        store.splitCue(
            cueID: "cue_000001",
            textBoundaryUTF16Offset: nil,
            playheadMs: 500,
            undoManager: nil
        )
        #expect(store.cues == before)
        #expect(store.statusMessage.contains("Place the text caret"))
        #expect(store.statusMessage.contains("preserved"))
    }

    @Test("speaker rename commits normalized names and rejects invalid drafts safely")
    func speakerRenameCommit() {
        let store = TranscriptReviewStore()
        store.load(workspace())
        store.speakerNameDraft = "  Alonso  "
        #expect(store.commitSpeakerRename(undoManager: nil))
        #expect(store.displayName("speaker-01") == "Alonso")
        store.speakerNameDraft = "Bad\nName"
        #expect(!store.commitSpeakerRename(undoManager: nil))
        #expect(store.speakerNameDraft == "Alonso")
        #expect(store.statusMessage.contains("was preserved"))
    }

    @Test("switching speakers commits the prior valid rename through the shared path")
    func speakerSwitchRenameCommit() {
        let store = TranscriptReviewStore()
        store.load(workspace())
        store.addSpeaker(undoManager: nil)
        store.selectRenameSpeaker("speaker-01", undoManager: nil)
        store.speakerNameDraft = "  Host  "
        store.selectRenameSpeaker("speaker-02", undoManager: nil)
        #expect(store.displayName("speaker-01") == "Host")
        #expect(store.renameSpeakerID == "speaker-02")
    }
}

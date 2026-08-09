import AppKit
import Foundation
import PodcastVisualizerCore
import SwiftUI
import Testing
@testable import PodcastVisualizerApp

@Suite("Transcript review store")
@MainActor
struct TranscriptReviewStoreTests {
    private final class NoopUpdateChecker: UpdateChecking {
        let canCheckForUpdates = true
        func checkForUpdates() {}
    }

    private func workspace() -> ReviewWorkspace {
        ReviewWorkspace(
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
}

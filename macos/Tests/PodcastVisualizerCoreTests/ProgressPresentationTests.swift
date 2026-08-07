import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Operation progress presentation")
struct ProgressPresentationTests {
    @Test("uses measured phase progress for percentage and ETA")
    func determinateProgress() throws {
        let detail = CLIProgressDetail(
            phase: "transcription",
            fraction: 0.25,
            processedMs: 15_000,
            outputIndex: 1,
            totalOutputs: 3
        )
        let progress = try #require(ProgressPresentation(detail: detail))
        #expect(progress.label == "Transcribing audio")
        #expect(progress.fraction == 0.25)
        #expect(progress.estimatedRemainingSeconds(elapsed: 10) == 30)
        #expect(progress.withOutputPosition(index: 4, total: 6).outputIndex == 4)
        #expect(progress.withOutputPosition(index: 4, total: 6).totalOutputs == 6)
    }

    @Test("keeps unmeasurable phases indeterminate")
    func indeterminateProgress() throws {
        let progress = try #require(ProgressPresentation(
            detail: CLIProgressDetail(phase: "diarization-finalizing")
        ))
        #expect(progress.fraction == nil)
        #expect(progress.estimatedRemainingSeconds(elapsed: 10) == nil)
    }
}

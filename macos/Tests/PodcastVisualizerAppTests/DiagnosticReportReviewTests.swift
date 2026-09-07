import Foundation
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@Suite("Report review and consent")
struct DiagnosticReportReviewTests {
    @Test("opening review never sends; partial failures preserve the remaining reviewed reports for retry")
    @MainActor
    func reviewedRetry() async throws {
        let temporaryRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
        let root = temporaryRoot.resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: root) }
        let log = try DiagnosticLogStore(directory: root,
            application: DiagnosticApplicationInfo(version: "1.3.0", build: "23", operatingSystem: "26.6.2", architecture: "arm64"))
        for _ in 0..<2 {
            await log.record(.commandFailed, command: "render", stage: "rendering", failureCode: "render_failure",
                diagnosticCode: "render_encoding_failed", exitCode: 6, durationMs: 2400,
                renderSettings: nil, context: DiagnosticContext(attemptID: UUID().uuidString.lowercased(),
                    failureDetails: FailureDetails(cause: "type_error")))
        }
        let submitter = ReviewSubmitter()
        let review = DiagnosticReportReviewStore(diagnostics: log, submitter: submitter, crashes: { [] })
        await review.load()
        #expect(review.reports.count == 2)
        #expect(await submitter.calls == 0)
        #expect(review.preview.contains("render_encoding_failed"))
        await review.sendReviewedReports()
        #expect(await submitter.calls == 2)
        #expect(review.reports.count == 1)
        #expect(review.message?.contains("preserved on this Mac") == true)
        #expect(review.message?.contains("Send again") == true)
        #expect(try await log.submittedReportIDs().count == 1)
        await review.sendReviewedReports()
        #expect(review.reports.isEmpty)
        #expect(review.issueNumbers == [42])
        await review.load()
        #expect(review.reports.isEmpty)
        #expect(await submitter.calls == 3)
        #expect(!AppPaths.supportSubmissionEnabled())
    }
}

private actor ReviewSubmitter: DiagnosticSubmitting {
    nonisolated let enabled = true
    private(set) var calls = 0
    func submit(_ report: DiagnosticSubmission) throws -> Int {
        calls += 1
        if calls == 2 { throw DiagnosticSubmissionError.rateLimited }
        return 42
    }
}

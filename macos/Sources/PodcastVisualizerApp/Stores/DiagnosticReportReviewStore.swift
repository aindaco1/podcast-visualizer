import Foundation
import Observation
import PodcastVisualizerCore

@MainActor @Observable
final class DiagnosticReportReviewStore {
    private(set) var reports: [DiagnosticSubmission] = []
    private(set) var isBusy = false
    private(set) var message: String?
    private(set) var issueNumbers: [Int] = []
    let enabled: Bool
    private let diagnostics: any DiagnosticLogging
    private let submitter: any DiagnosticSubmitting
    private let crashes: @Sendable () async throws -> [DiagnosticSubmission]

    init(diagnostics: any DiagnosticLogging, submitter: any DiagnosticSubmitting,
         crashes: @escaping @Sendable () async throws -> [DiagnosticSubmission] = DiagnosticReportReviewStore.nativeCrashes) {
        self.diagnostics = diagnostics
        self.submitter = submitter
        self.crashes = crashes
        enabled = submitter.enabled
    }

    var preview: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(reports)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
    }

    func load() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let submitted = try await diagnostics.submittedReportIDs()
            let failures = try await diagnostics.submissionReports()
            let native = try await crashes()
            var seen = submitted
            reports = (failures + native).filter { $0.isValid && seen.insert($0.id).inserted }.suffix(20)
            message = reports.isEmpty ? "No new failure reports are available. You can still export the local diagnostic log." : nil
        } catch {
            reports = []
            message = "Reports could not be read. Your projects and local diagnostic history were preserved. Close this window and try again, or export the diagnostic log."
        }
    }

    func sendReviewedReports() async {
        guard enabled, !isBusy, !reports.isEmpty else { return }
        isBusy = true
        defer { isBusy = false }
        let reviewed = reports
        var sent = 0
        for report in reviewed {
            do {
                let number = try await submitter.submit(report)
                await diagnostics.markReportSubmitted(report.id)
                reports.removeAll { $0.id == report.id }
                if !issueNumbers.contains(number) { issueNumbers.append(number) }
                sent += 1
            } catch {
                message = "Sent \(sent) of \(reviewed.count) reports. Remaining reports and all project data were preserved on this Mac. \(error as? DiagnosticSubmissionError == .rateLimited ? "Wait a few minutes" : "Check your connection") and try Send again, or export the diagnostic log."
                return
            }
        }
        message = "Sent \(sent) reports. Matching reports are grouped in the same GitHub issue. Your projects and local diagnostic history were preserved."
    }

    nonisolated static func nativeCrashes() async throws -> [DiagnosticSubmission] {
        try await Task.detached(priority: .utility) {
            let directory = NativeCrashSummary.directory
            guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
            return try NativeCrashSummary.recentReports(directory: directory)
        }.value
    }
}

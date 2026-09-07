import Foundation
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@Suite("App failure presentation")
struct AppStoreFailureTests {
    @Test("failed render records its actual settings and allows retry without reopening", arguments: [false, true])
    @MainActor
    func renderFailureDiagnosticsAndRetry(invalidFinalResult: Bool) async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true).resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let diagnostics = try DiagnosticLogStore(
            directory: root.appendingPathComponent("Diagnostics", isDirectory: true),
            application: DiagnosticApplicationInfo(version: "test", build: "test",
                                                  operatingSystem: "test", architecture: "arm64")
        )
        let builder = try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false"))
        let client = RenderFailureClient(invalidFinalResult: invalidFinalResult)
        let store = AppStore(client: client, commands: builder,
                             updateChecker: NoopUpdateChecker(), brand: nil, diagnostics: diagnostics)
        let status = try ContractDecoder.decode(StatusResult.self, from: JSONSerialization.data(withJSONObject: [
            "projectRoot": "/Users/private/Secret-project", "sourcePath": "/Users/private/Secret-source.wav",
            "projectId": "project_aaaaaaaaaaaaaaaa_20260907000000", "sourceSha256": String(repeating: "a", count: 64),
            "state": "aligned", "clip": ["startsAtMs": 0, "endsAtMs": 1000, "durationMs": 1000],
            "transcript": ["words": 2, "speakers": 1, "recognizedSpeakers": 0, "cues": 1]
        ]))
        try store.state.reduce(.projectOpened(status))
        store.renderSelection = RenderSelection(aspects: [.portrait], profiles: [.proResAlpha])
        for attempt in 1...2 {
            store.runNext()
            for _ in 0..<200 {
                if await client.runCount == attempt && store.state.failure != nil && !store.isRunning { break }
                try await Task.sleep(for: .milliseconds(10))
            }
            #expect(await client.runCount == attempt)
            if invalidFinalResult {
                #expect(store.state.failure != nil)
            } else {
                #expect(store.state.failure?.diagnosticCode == "render_scene_failed")
            }
            #expect(store.state.failure?.hint?.contains("preserved") == true)
            #expect(store.state.stage == .aligned)
            #expect(!store.isRunning)
        }
        let destination = root.appendingPathComponent("report.json")
        _ = try await diagnostics.export(to: destination)
        let data = try Data(contentsOf: destination)
        let report = try JSONDecoder().decode(DiagnosticSupportReport.self, from: data)
        let commands = report.events.filter { $0.command == "render" && $0.kind != .renderCheckpoint }
        let checkpoints = report.events.filter { $0.kind == .renderCheckpoint }
        #expect(checkpoints.count == 2)
        let failures = commands.filter { $0.kind == .commandFailed }
        #expect(Set(failures.compactMap { $0.context?.attemptID }).count == 2)
        #expect(failures.allSatisfy { $0.context?.renderProgress?.phase == "encoding"
            && $0.context?.renderProgress?.outputIndex == 2
            && $0.context?.renderProgress?.fraction == 0.5
            && $0.exitCode == (invalidFinalResult ? 0 : 6) })
        if !invalidFinalResult {
            #expect(failures.allSatisfy { $0.context?.failureDetails?.cause == "type_error" })
        }
        let expectedKinds: [DiagnosticEventKind] = invalidFinalResult
            ? [.commandStarted, .commandCompleted, .commandFailed, .commandStarted, .commandCompleted, .commandFailed]
            : [.commandStarted, .commandFailed, .commandStarted, .commandFailed]
        #expect(commands.map(\.kind) == expectedKinds)
        let expected = try #require(store.renderSelection.invocations().first)
        #expect(commands.allSatisfy { $0.renderSettings == expected && $0.stage == "rendering" })
        #expect(!String(decoding: data, as: UTF8.self).contains("Secret-"))
    }

    @Test("invalid progress explains recovery and preserved data")
    @MainActor
    func invalidProgressRecovery() {
        let failure = AppStore.workflowFailure(for: SubprocessError.invalidProgress)

        #expect(failure.code == "invalid_progress")
        #expect(failure.details?.cause == "invalid_progress")
        #expect(failure.message == "Podcast Visualizer could not read progress from its local helper.")
        #expect(failure.hint?.contains("preserved") == true)
        #expect(failure.hint?.contains("Reopen the existing project") == true)
        #expect(failure.hint?.contains("restart Podcast Visualizer") == true)
    }

    @Test("unexpected app errors are private and direct users to diagnostics")
    @MainActor
    func unexpectedFailureRecovery() {
        let failure = AppStore.workflowFailure(for: PrivateFixtureError())

        #expect(failure.code == "app_error")
        #expect(!failure.message.contains("/Users/private"))
        #expect(failure.hint?.contains("preserved") == true)
        #expect(failure.hint?.contains("export a diagnostic log") == true)
    }

    @Test("diagnostic export failures preserve existing data")
    @MainActor
    func diagnosticExportRecovery() {
        let existing = AppStore.diagnosticExportFailure(
            for: DiagnosticLogError.destinationMustBeNew
        )
        #expect(existing.message.contains("did not replace"))
        #expect(existing.hint?.contains("preserved") == true)
        #expect(existing.hint?.contains("new filename") == true)

        let failed = AppStore.diagnosticExportFailure(for: PrivateFixtureError())
        #expect(failed.message.contains("could not export"))
        #expect(failed.hint?.contains("diagnostic history were preserved") == true)
        #expect(!failed.message.contains("/Users/private"))
    }

    @Test("oversized private edits name recovery and preserved data")
    func privateEditRecovery() {
        #expect(PrivateEditKind.review.maximumBytes == 2 * 1024 * 1024)
        #expect(PrivateEditKind.chapters.maximumBytes == 256 * 1024)
        #expect(PrivateEditKind.branding.maximumBytes == 64 * 1024)
        for kind in PrivateEditKind.allCases {
            #expect(!kind.oversizedFailure.message.isEmpty)
            #expect(kind.oversizedFailure.hint?.contains("preserved") == true)
            #expect(kind.oversizedFailure.hint?.contains("try again") == true)
        }
    }
}

@MainActor
private final class NoopUpdateChecker: UpdateChecking {
    let canCheckForUpdates = true
    func checkForUpdates() {}
}

private actor RenderFailureClient: CLIExecuting {
    private(set) var runCount = 0
    let invalidFinalResult: Bool
    init(invalidFinalResult: Bool) { self.invalidFinalResult = invalidFinalResult }
    func run(_ command: CLICommand,
             onProgress: @escaping @Sendable (CLIProgressEvent) async -> Void) async throws -> CLIExecution {
        runCount += 1
        for fraction in [0.0, 0.25, 0.5] {
            await onProgress(try ContractDecoder.decode(CLIProgressEvent.self, from: JSONSerialization.data(withJSONObject: [
                "schemaVersion": CLIProgressEvent.schema, "command": "render", "event": "render.progress",
                "sequence": Int(fraction * 4) + 1, "detail": ["phase": "encoding", "fraction": fraction,
                    "processedMs": fraction * 1000, "outputIndex": 2, "totalOutputs": 2,
                    "aspect": "9:16", "background": "transparent", "alphaCodec": "prores"]
            ])))
        }
        // A final failure event must not erase the last useful render checkpoint.
        await onProgress(try ContractDecoder.decode(CLIProgressEvent.self, from: Data("""
        {"schemaVersion":"podcast-visualizer-progress-v1","command":"render","event":"command.failed","sequence":4,"detail":{"code":"failure","message":"Secret-text"}}
        """.utf8)))
        if invalidFinalResult {
            return CLIExecution(exitCode: 0, standardOutput: Data("invalid JSON".utf8), standardError: Data())
        }
        return CLIExecution(exitCode: 6, standardOutput: Data(), standardError: Data("""
        {"schemaVersion":"podcast-visualizer-error-v1","command":"render","exitCode":6,"error":{"code":"render_failure","diagnosticCode":"render_scene_failed","failureDetails":{"cause":"type_error"},"message":"The video layout could not be prepared.","hint":"Existing media and saved edits were preserved. Retry rendering."}}
        """.utf8))
    }
    func cancelCurrentCommand() async {}
}

private struct PrivateFixtureError: Error, CustomStringConvertible {
    var description: String { "/Users/private/secret-transcript.json" }
}

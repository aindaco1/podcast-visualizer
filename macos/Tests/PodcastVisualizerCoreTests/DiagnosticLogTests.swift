import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Private diagnostic log")
struct DiagnosticLogTests {
    @Test("render settings are bounded, survive export, and retain legacy events")
    func renderSettingsExport() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("Diagnostics", isDirectory: true)
        let store = try DiagnosticLogStore(directory: directory, application: applicationInfo)
        let builder = try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false"))
        let command = try #require(builder.render(
            project: URL(fileURLWithPath: "/Users/private/Secret-project"),
            selection: RenderSelection(aspects: [.portrait], profiles: [.proResAlpha])
        ).first)
        for kind in [DiagnosticEventKind.commandStarted, .commandFailed, .commandCompleted] {
            await store.record(kind, command: command.label, stage: "rendering",
                               failureCode: kind == .commandFailed ? "render_failure" : nil,
                               diagnosticCode: kind == .commandFailed ? "render_scene_failed" : nil,
                               exitCode: 6, durationMs: 2_400, renderSettings: command.renderSettings,
                               context: DiagnosticContext(attemptID: UUID().uuidString.lowercased(),
                                   renderProgress: RenderProgressSnapshot(CLIProgressDetail(phase: "encoding", fraction: 0.5,
                                       processedMs: 1250, outputIndex: 2, totalOutputs: 3, aspect: "9:16", background: "transparent", alphaCodec: "prores")),
                                   failureDetails: FailureDetails(cause: "process_exit", processExitCode: 1, reason: "disk_full")))
        }
        let logURL = directory.appendingPathComponent("events.jsonl")
        let lines = try String(contentsOf: logURL, encoding: .utf8).split(separator: "\n")
        var legacy = try #require(JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as? [String: Any])
        legacy["schemaVersion"] = DiagnosticEvent.legacySchema
        legacy.removeValue(forKey: "renderSettings")
        legacy.removeValue(forKey: "context")
        var unknownField = try #require(JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as? [String: Any])
        unknownField["renderSettings"] = ["aspect": "9:16", "background": "transparent",
                                           "alphaCodec": "prores", "sourcePath": "/Users/private/Secret-project"]
        var invalidValue = unknownField
        invalidValue["renderSettings"] = ["aspect": "/Users/private/Secret-project",
                                           "background": "transparent", "alphaCodec": "prores"]
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()
        var unsafeContext = unknownField
        unsafeContext["renderSettings"] = nil
        unsafeContext["context"] = ["attemptID": UUID().uuidString.lowercased(), "failureDetails": ["cause": "process_exit", "stderr": "Secret-project"]]
        for object in [legacy, unknownField, invalidValue, unsafeContext] {
            try handle.write(contentsOf: JSONSerialization.data(withJSONObject: object) + Data([0x0A]))
        }
        try handle.close()
        let destination = root.appendingPathComponent("report.json")
        _ = try await store.export(to: destination)
        let data = try Data(contentsOf: destination)
        let report = try JSONDecoder().decode(DiagnosticSupportReport.self, from: data)
        #expect(report.skippedInvalidRecordCount == 3)
        #expect(report.events[0].context?.renderProgress?.outputIndex == 2)
        #expect(report.events[0].context?.failureDetails?.reason == "disk_full")
        #expect(report.events.prefix(3).allSatisfy { $0.renderSettings == command.renderSettings })
        #expect(report.events[3].schemaVersion == DiagnosticEvent.legacySchema)
        #expect(report.events[3].renderSettings == nil)
        #expect(!String(decoding: data, as: UTF8.self).contains("Secret-project"))
    }

    @Test("exports bounded operational metadata without private inputs")
    func privateExport() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("Diagnostics", isDirectory: true)
        let destination = root.appendingPathComponent("support-report.json")
        let store = try DiagnosticLogStore(
            directory: directory,
            application: applicationInfo,
            sessionID: "session-test-01"
        )

        await store.record(
            .commandStarted,
            command: "init",
            stage: "sourceSelected",
            failureCode: nil,
            diagnosticCode: nil,
            exitCode: nil,
            durationMs: nil
        )
        await store.record(
            .commandFailed,
            command: "init",
            stage: "sourceSelected",
            failureCode: "usage",
            diagnosticCode: "project_name_unsafe",
            exitCode: 2,
            durationMs: 42
        )
        let summary = try await store.export(to: destination)
        let data = try Data(contentsOf: destination)
        let report = try JSONDecoder().decode(DiagnosticSupportReport.self, from: data)
        let text = String(decoding: data, as: UTF8.self)

        #expect(summary.eventCount == 3)
        #expect(report.schemaVersion == DiagnosticSupportReport.schema)
        #expect(report.events.map(\.kind) == [
            .commandStarted, .commandFailed, .supportExportRequested,
        ])
        #expect(report.events.first(where: { $0.kind == .commandFailed })?.diagnosticCode
            == "project_name_unsafe")
        #expect(!text.contains("/Users/private/Episode 5_1.wav"))
        #expect(!text.contains("project directory name is unsafe"))
        #expect(report.excludedData.contains("transcript text"))
        let permissions = try FileManager.default.attributesOfItem(atPath: destination.path)[.posixPermissions]
            as? NSNumber
        #expect(permissions?.intValue == 0o600)
    }

    @Test("rotates two bounded local files")
    func boundedRotation() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("Diagnostics", isDirectory: true)
        let destination = root.appendingPathComponent("support-report.json")
        let store = try DiagnosticLogStore(
            directory: directory,
            application: applicationInfo,
            sessionID: "session-test-02",
            maximumLogBytes: 1_024
        )

        for _ in 0..<40 {
            await store.record(
                .commandCompleted,
                command: "render",
                stage: "rendering",
                failureCode: nil,
                diagnosticCode: nil,
                exitCode: 0,
                durationMs: 1_000
            )
        }
        _ = try await store.export(to: destination)

        for name in ["events.previous.jsonl", "events.jsonl"] {
            let file = directory.appendingPathComponent(name)
            let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize
            #expect(size != nil && size! <= 1_024)
        }
        let report = try JSONDecoder().decode(
            DiagnosticSupportReport.self,
            from: Data(contentsOf: destination)
        )
        #expect(!report.events.isEmpty)
        #expect(report.events.count < 40)
    }

    @Test("does not follow a tampered log symlink")
    func rejectsSymlink() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("Diagnostics", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let outside = root.appendingPathComponent("preserve.txt")
        try Data("preserve".utf8).write(to: outside)
        try FileManager.default.createSymbolicLink(
            at: directory.appendingPathComponent("events.jsonl"),
            withDestinationURL: outside
        )
        let store = try DiagnosticLogStore(
            directory: directory,
            application: applicationInfo,
            sessionID: "session-test-03"
        )

        await store.record(
            .appStarted,
            command: nil,
            stage: "empty",
            failureCode: nil,
            diagnosticCode: nil,
            exitCode: nil,
            durationMs: nil
        )
        do {
            _ = try await store.export(to: root.appendingPathComponent("report.json"))
            Issue.record("Expected the tampered log to be rejected")
        } catch {
            #expect(error as? DiagnosticLogError == .unsafeLogFile)
        }
        #expect(try String(contentsOf: outside, encoding: .utf8) == "preserve")
    }

    @Test("does not follow a tampered diagnostics-directory symlink")
    func rejectsDirectorySymlink() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let outside = root.appendingPathComponent("Outside", isDirectory: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        let directory = root.appendingPathComponent("Diagnostics", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: directory, withDestinationURL: outside)
        let store = try DiagnosticLogStore(
            directory: directory,
            application: applicationInfo,
            sessionID: "session-test-05"
        )

        await store.record(
            .appStarted,
            command: nil,
            stage: "empty",
            failureCode: nil,
            diagnosticCode: nil,
            exitCode: nil,
            durationMs: nil
        )
        do {
            _ = try await store.export(to: root.appendingPathComponent("report.json"))
            Issue.record("Expected the symlinked diagnostics directory to be rejected")
        } catch {
            #expect(error as? DiagnosticLogError == .unsafeDirectory)
        }
        #expect((try FileManager.default.contentsOfDirectory(atPath: outside.path)).isEmpty)
    }

    @Test("never replaces an existing support report")
    func preservesExistingDestination() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let destination = root.appendingPathComponent("existing.json")
        try Data("keep".utf8).write(to: destination)
        let store = try DiagnosticLogStore(
            directory: root.appendingPathComponent("Diagnostics", isDirectory: true),
            application: applicationInfo,
            sessionID: "session-test-04"
        )

        do {
            _ = try await store.export(to: destination)
            Issue.record("Expected an existing support report to be preserved")
        } catch {
            #expect(error as? DiagnosticLogError == .destinationMustBeNew)
        }
        #expect(try String(contentsOf: destination, encoding: .utf8) == "keep")
    }

    private var applicationInfo: DiagnosticApplicationInfo {
        DiagnosticApplicationInfo(
            version: "1.2.0",
            build: "1",
            operatingSystem: "macOS Test",
            architecture: "arm64"
        )
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("podcast-diagnostics-\(UUID().uuidString)", isDirectory: true)
            .resolvingSymlinksInPath()
    }
}

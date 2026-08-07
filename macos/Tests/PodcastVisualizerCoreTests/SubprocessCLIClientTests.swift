import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("POSIX CLI client")
struct SubprocessCLIClientTests {
    private var node: URL {
        TestSupport.repositoryRoot.appendingPathComponent("runtime/macos-arm64/bin/node")
    }

    private var fixture: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/fake-cli.mjs")
    }

    @Test("spawns with arrays and streams a dedicated progress descriptor")
    func streamsProgress() async throws {
        let client = try SubprocessCLIClient()
        let command = try CLICommand(
            executable: node,
            arguments: [fixture.path, "success"],
            label: "fixture"
        )
        let recorder = ProgressRecorderForProcess()
        let result = try await client.run(command) { event in await recorder.append(event) }
        #expect(result.exitCode == 0)
        #expect(try JSONSerialization.jsonObject(with: result.standardOutput) as? [String: Bool] == ["ok": true])
        #expect(await recorder.events.map(\.event) == ["command.started", "command.completed"])
    }

    @Test("terminates the complete process group on cancellation")
    func cancellation() async throws {
        let client = try SubprocessCLIClient()
        let command = try CLICommand(
            executable: node,
            arguments: [fixture.path, "wait"],
            label: "fixture"
        )
        let task = Task { try await client.run(command) { _ in } }
        try await Task.sleep(for: .milliseconds(150))
        await client.cancelCurrentCommand()
        await #expect(throws: CancellationError.self) {
            try await task.value
        }
    }

    @Test("kills commands that exceed bounded output")
    func boundedOutput() async throws {
        let client = try SubprocessCLIClient()
        let command = try CLICommand(
            executable: node,
            arguments: [fixture.path, "oversized"],
            label: "fixture"
        )
        await #expect(throws: SubprocessError.self) {
            try await client.run(command) { _ in }
        }
    }

    @Test("passes only the explicit app-owned models root")
    func modelsEnvironment() async throws {
        let root = URL(fileURLWithPath: "/tmp/Podcast Visualizer Tests/Models", isDirectory: true)
        let client = try SubprocessCLIClient(modelsRoot: root)
        let command = try CLICommand(
            executable: node,
            arguments: [fixture.path, "environment"],
            label: "fixture"
        )
        let result = try await client.run(command) { _ in }
        let value = try JSONSerialization.jsonObject(with: result.standardOutput) as! [String: String]
        #expect(value["modelsRoot"] == root.path)
        #expect(throws: SubprocessError.invalidModelsRoot) {
            try SubprocessCLIClient(modelsRoot: URL(string: "https://example.invalid/models")!)
        }
        #expect(throws: SubprocessError.invalidModelsRoot) {
            try SubprocessCLIClient(modelsRoot: URL(fileURLWithPath: "/", isDirectory: true))
        }
    }
}

private actor ProgressRecorderForProcess {
    private(set) var events: [CLIProgressEvent] = []
    func append(_ event: CLIProgressEvent) { events.append(event) }
}

import Foundation
import Testing
@testable import PodcastVisualizerCore

private actor FakeCLI: CLIExecuting {
    private var cancelled = false

    func run(
        _ command: CLICommand,
        onProgress: @escaping @Sendable (CLIProgressEvent) async -> Void
    ) async throws -> CLIExecution {
        let line = #"{"schemaVersion":"podcast-visualizer-progress-v1","sequence":1,"command":"probe","event":"command.started","detail":{}}"#
        let progress = try ContractDecoder.decode(CLIProgressEvent.self, from: Data(line.utf8), maximumBytes: 8 * 1024)
        await onProgress(progress)
        try await Task.sleep(for: .milliseconds(20))
        if cancelled { throw CancellationError() }
        return CLIExecution(exitCode: 0, standardOutput: Data("{}".utf8), standardError: Data())
    }

    func cancelCurrentCommand() {
        cancelled = true
    }
}

@Suite("CLI execution boundary")
struct CLIExecutionTests {
    @Test("streams progress through the narrow protocol")
    func streamsProgress() async throws {
        let fake = FakeCLI()
        let command = try CLICommand(
            executable: URL(fileURLWithPath: "/tmp/fake-cli"),
            arguments: ["probe", "--json", "--progress-fd", "3"],
            label: "probe"
        )
        let recorder = ProgressRecorder()
        let result = try await fake.run(command) { event in await recorder.append(event) }
        #expect(result.exitCode == 0)
        #expect(await recorder.events.map(\.event) == ["command.started"])
    }

    @Test("supports cooperative cancellation")
    func cancellation() async throws {
        let fake = FakeCLI()
        let command = try CLICommand(
            executable: URL(fileURLWithPath: "/tmp/fake-cli"),
            arguments: ["probe", "--json", "--progress-fd", "3"],
            label: "probe"
        )
        await fake.cancelCurrentCommand()
        await #expect(throws: CancellationError.self) {
            try await fake.run(command) { _ in }
        }
    }
}

private actor ProgressRecorder {
    private(set) var events: [CLIProgressEvent] = []
    func append(_ event: CLIProgressEvent) { events.append(event) }
}

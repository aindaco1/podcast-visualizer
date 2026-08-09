import Foundation
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@Suite("Release model library")
@MainActor
struct ModelLibraryTests {
    private final class NoopUpdateChecker: UpdateChecking {
        let canCheckForUpdates = true
        func checkForUpdates() {}
    }

    @Test("release model root is app-owned and bundle-version independent")
    func persistentReleaseRoot() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-release-models-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: root) }
        let support = root.appendingPathComponent("Application Support", isDirectory: true)
        let expected = support
            .appendingPathComponent("Podcast Visualizer/Models", isDirectory: true)
            .standardizedFileURL
        try fileManager.createDirectory(
            at: expected.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true),
            withIntermediateDirectories: true
        )
        let originalBundle = root.appendingPathComponent(
            "Applications/Podcast Visualizer.app",
            isDirectory: true
        )
        let updatedBundle = root.appendingPathComponent(
            "AppTranslocation/Podcast Visualizer.app",
            isDirectory: true
        )

        #expect(AppPaths.modelsRoot(
            fileManager: fileManager,
            bundleURL: originalBundle,
            applicationSupportDirectory: support
        ) == expected)
        #expect(AppPaths.modelsRoot(
            fileManager: fileManager,
            bundleURL: updatedBundle,
            applicationSupportDirectory: support
        ) == expected)
    }

    @Test("selected Parakeet is imported and immediately rechecked")
    func importAndRefresh() async throws {
        let client = RecordingModelCLI()
        let store = AppStore(
            client: client,
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")),
            updateChecker: NoopUpdateChecker(),
            brand: nil
        )
        let source = URL(
            fileURLWithPath: "/Users/example/Selected Models/parakeet-tdt-0.6b-v3",
            isDirectory: true
        )

        await store.importExternalModel(.parakeet, from: source)

        #expect(store.modelLibrary.check(for: .parakeet)?.ok == true)
        #expect(store.state.failure == nil)
        #expect(store.state.activeCommand == nil)
        let commands = await client.recordedArguments()
        #expect(commands.count == 2)
        #expect(commands[0].starts(with: [
            "models", "import", "parakeet-v3", "--source", source.path,
        ]))
        #expect(commands[1].starts(with: ["models", "status"]))
    }

    @Test("release workflow waits for the model required by its next stage")
    func analysisGate() throws {
        let store = AppStore(
            client: RecordingModelCLI(),
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")),
            updateChecker: NoopUpdateChecker(),
            brand: nil
        )
        let digest = String(repeating: "a", count: 64)
        let status = try ContractDecoder.decode(StatusResult.self, from: try JSONSerialization.data(
            withJSONObject: [
                "projectRoot": "/Users/example/Project",
                "projectId": "project_aaaaaaaaaaaaaaaa_20260808010101",
                "state": "prepared",
                "sourcePath": "/Users/example/episode.wav",
                "sourceSha256": digest,
                "clip": ["startsAtMs": 0, "endsAtMs": 1_000, "durationMs": 1_000],
            ]
        ))
        try store.state.reduce(.projectOpened(status))
        let missing = try ContractDecoder.decode(ModelStatusResult.self, from: try JSONSerialization.data(
            withJSONObject: [
                "ok": false,
                "checks": [
                    ["id": "parakeet-v3", "ok": false, "modelRoot": NSNull(), "detail": "missing"],
                    ["id": "align-en", "ok": false, "modelRoot": NSNull(), "detail": "missing"],
                ],
            ]
        ))
        store.modelLibrary.load(missing)

        #expect(!store.canRunNext)
        #expect(store.nextActionLabel == "Import Parakeet to Continue")

        let approvedStatus = try ContractDecoder.decode(
            StatusResult.self,
            from: try JSONSerialization.data(withJSONObject: [
                "projectRoot": "/Users/example/Project",
                "projectId": "project_aaaaaaaaaaaaaaaa_20260808010101",
                "state": "approved",
                "sourcePath": "/Users/example/episode.wav",
                "sourceSha256": digest,
                "clip": ["startsAtMs": 0, "endsAtMs": 1_000, "durationMs": 1_000],
            ])
        )
        try store.state.reduce(.projectOpened(approvedStatus))
        let missingAlignment = try ContractDecoder.decode(
            ModelStatusResult.self,
            from: try JSONSerialization.data(withJSONObject: [
                "ok": false,
                "checks": [
                    ["id": "parakeet-v3", "ok": true, "modelRoot": NSNull(), "detail": "ready"],
                    ["id": "align-en", "ok": false, "modelRoot": NSNull(), "detail": "missing"],
                ],
            ])
        )
        store.modelLibrary.load(missingAlignment)

        #expect(!store.canRunNext)
        #expect(store.nextActionLabel == "Import Alignment to Continue")
    }
}

private actor RecordingModelCLI: CLIExecuting {
    private var arguments: [[String]] = []
    private var parakeetImported = false

    func run(
        _ command: CLICommand,
        onProgress: @escaping @Sendable (CLIProgressEvent) async -> Void
    ) async throws -> CLIExecution {
        arguments.append(command.arguments)
        let output: [String: Any]
        if command.arguments.starts(with: ["models", "import", "parakeet-v3"]) {
            parakeetImported = true
            output = [
                "model": "parakeet-v3",
                "destination": "/Users/example/Container/Models/parakeet-tdt-0.6b-v3",
                "reused": false,
                "version": String(repeating: "a", count: 40),
            ]
        } else if command.arguments.starts(with: ["models", "status"]) {
            output = [
                "ok": false,
                "checks": [
                    [
                        "id": "parakeet-v3", "ok": parakeetImported,
                        "modelRoot": "/Users/example/Container/Models/parakeet-tdt-0.6b-v3",
                        "detail": parakeetImported ? "Parakeet fixture" : "missing",
                    ],
                    [
                        "id": "align-en", "ok": false,
                        "modelRoot": "/Users/example/Container/Models/alignment/whisperx-en",
                        "detail": "missing",
                    ],
                    ["id": "diarization", "ok": true, "modelRoot": NSNull(), "detail": "Bundled"],
                ],
            ]
        } else {
            throw TestModelError.unexpectedCommand
        }
        return CLIExecution(
            exitCode: 0,
            standardOutput: try JSONSerialization.data(withJSONObject: output),
            standardError: Data()
        )
    }

    func cancelCurrentCommand() {}

    func recordedArguments() -> [[String]] { arguments }
}

private enum TestModelError: Error {
    case unexpectedCommand
}

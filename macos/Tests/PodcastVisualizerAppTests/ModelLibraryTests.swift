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

    @Test("diagnostics root is app-owned and separate from projects")
    func diagnosticsRoot() {
        let support = URL(fileURLWithPath: "/Users/example/Library/Application Support", isDirectory: true)
        #expect(AppPaths.diagnosticsDirectory(applicationSupportDirectory: support).path ==
            "/Users/example/Library/Application Support/Podcast Visualizer/Diagnostics")
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

    @Test("Downloads candidates use exact conventional model paths")
    func exactAutomaticCandidates() {
        let downloads = URL(fileURLWithPath: "/Users/example/Downloads", isDirectory: true)
        let location = ModelSearchLocation(
            id: "downloads",
            title: "Downloads",
            directory: downloads,
            kind: .downloads
        )
        #expect(location.candidates(for: .parakeet).map(\.path) == [
            "/Users/example/Downloads/parakeet-tdt-0.6b-v3",
            "/Users/example/Downloads/Podcast Visualizer Models/parakeet-tdt-0.6b-v3",
        ])
        #expect(location.candidates(for: .alignment).map(\.path) == [
            "/Users/example/Downloads/whisperx-en",
            "/Users/example/Downloads/alignment/whisperx-en",
            "/Users/example/Downloads/Podcast Visualizer Models/whisperx-en",
            "/Users/example/Downloads/Podcast Visualizer Models/alignment/whisperx-en",
        ])
        let appStorage = ModelSearchLocation(
            id: "app-storage",
            title: "App Storage",
            directory: URL(fileURLWithPath: "/Users/example/Container/Models", isDirectory: true),
            kind: .appStorage
        )
        #expect(appStorage.candidates(for: .parakeet).isEmpty)
    }

    @Test("user-approved search locations persist as removable read-only bookmarks")
    func persistentSearchLocation() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-bookmarks-\(UUID().uuidString)", isDirectory: true)
            .resolvingSymlinksInPath()
        defer { try? fileManager.removeItem(at: root) }
        let custom = root.appendingPathComponent("Shared Models", isDirectory: true)
        try fileManager.createDirectory(at: custom, withIntermediateDirectories: true)
        let suite = "podcast-visualizer-model-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let makeLibrary = {
            PersistentModelSourceLibrary(
                defaults: defaults,
                fileManager: fileManager,
                appOwnedRoot: root.appendingPathComponent("App Models", isDirectory: true),
                activeModelsRoot: root.appendingPathComponent("App Models", isDirectory: true),
                downloadsRoot: root.appendingPathComponent("Downloads", isDirectory: true)
            )
        }
        let library = makeLibrary()
        try library.addUserApprovedDirectory(custom)
        let added = try #require(library.locations.first { $0.kind == .userApproved })
        #expect(added.directory == custom)

        let restored = makeLibrary()
        #expect(restored.locations.contains { $0.directory == custom && $0.kind == .userApproved })
        restored.removeLocation(id: added.id)
        #expect(!restored.locations.contains { $0.kind == .userApproved })

        defaults.set(try JSONSerialization.data(withJSONObject: [[
            "id": UUID().uuidString,
            "bookmark": Data([0x01]).base64EncodedString(),
            "unexpected": true,
        ]]), forKey: "model-search-locations-v1")
        #expect(!makeLibrary().locations.contains { $0.kind == .userApproved })
    }

    @Test("startup automatically imports an exact model found in an approved location")
    func automaticImport() async throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-auto-models-\(UUID().uuidString)", isDirectory: true)
            .resolvingSymlinksInPath()
        defer { try? fileManager.removeItem(at: root) }
        let parakeet = root.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true)
        try fileManager.createDirectory(at: parakeet, withIntermediateDirectories: true)
        let sources = FixedModelSources(locations: [ModelSearchLocation(
            id: "downloads",
            title: "Downloads",
            directory: root,
            kind: .downloads
        )])
        let client = RecordingModelCLI()
        let store = AppStore(
            client: client,
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")),
            updateChecker: NoopUpdateChecker(),
            brand: nil,
            modelSources: sources
        )

        await store.loadModelsIfNeeded()

        #expect(store.modelLibrary.check(for: .parakeet)?.ok == true)
        #expect(store.state.failure == nil)
        let commands = await client.recordedArguments()
        #expect(commands.count == 3)
        #expect(commands[0].starts(with: ["models", "status"]))
        #expect(commands[1].starts(with: [
            "models", "import", "parakeet-v3", "--source", parakeet.path,
        ]))
        #expect(commands[2].starts(with: ["models", "status"]))
    }

    @Test("automatic discovery ignores symbolic-link model folders")
    func automaticDiscoveryRejectsSymlink() async throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-auto-symlink-\(UUID().uuidString)", isDirectory: true)
            .resolvingSymlinksInPath()
        defer { try? fileManager.removeItem(at: root) }
        let outside = root.appendingPathComponent("outside", isDirectory: true)
        try fileManager.createDirectory(at: outside, withIntermediateDirectories: true)
        try fileManager.createSymbolicLink(
            at: root.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true),
            withDestinationURL: outside
        )
        let client = RecordingModelCLI()
        let store = AppStore(
            client: client,
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")),
            updateChecker: NoopUpdateChecker(),
            brand: nil,
            modelSources: FixedModelSources(locations: [ModelSearchLocation(
                id: "downloads",
                title: "Downloads",
                directory: root,
                kind: .downloads
            )])
        )

        await store.loadModelsIfNeeded()

        #expect(store.modelLibrary.check(for: .parakeet)?.ok == false)
        let commands = await client.recordedArguments()
        #expect(commands.count == 1)
    }

    @Test("download command is followed by an immediate verified status check")
    func downloadAndRefresh() async throws {
        let client = RecordingModelCLI()
        let store = AppStore(
            client: client,
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")),
            updateChecker: NoopUpdateChecker(),
            brand: nil,
            modelSources: FixedModelSources(locations: [])
        )

        await store.downloadExternalModel(.parakeet)

        #expect(store.modelLibrary.check(for: .parakeet)?.ok == true)
        #expect(store.state.failure == nil)
        let commands = await client.recordedArguments()
        #expect(commands.count == 2)
        #expect(commands[0].starts(with: ["models", "download", "parakeet-v3"]))
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
        #expect(store.nextActionLabel == "Set Up Parakeet to Continue")

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
        #expect(store.nextActionLabel == "Set Up Alignment to Continue")
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
        if command.arguments.starts(with: ["models", "import", "parakeet-v3"])
            || command.arguments.starts(with: ["models", "download", "parakeet-v3"]) {
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

@MainActor
private final class FixedModelSources: ModelSourceProviding {
    var locations: [ModelSearchLocation]

    init(locations: [ModelSearchLocation]) {
        self.locations = locations
    }

    func addUserApprovedDirectory(_ directory: URL) throws {}

    func removeLocation(id: String) {
        locations.removeAll { $0.id == id }
    }
}

private enum TestModelError: Error {
    case unexpectedCommand
}

import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("External models root resolution")
struct ModelsRootResolverTests {
    @Test("reuses models from the exact development app layout")
    func developmentModels() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try fixture.installParakeet(at: fixture.developmentModels)

        #expect(ModelsRootResolver.resolve(
            appOwnedRoot: fixture.appOwnedModels,
            bundleURL: fixture.developmentBundle
        ) == fixture.developmentModels)
    }

    @Test("prefers an existing app-owned installation")
    func appOwnedModels() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try fixture.installParakeet(at: fixture.developmentModels)
        try fixture.installParakeet(at: fixture.appOwnedModels)

        #expect(ModelsRootResolver.resolve(
            appOwnedRoot: fixture.appOwnedModels,
            bundleURL: fixture.developmentBundle
        ) == fixture.appOwnedModels)
    }

    @Test("release layouts do not scan for development models")
    func releaseIsolation() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        try fixture.installParakeet(at: fixture.developmentModels)
        let releaseBundle = fixture.root
            .appendingPathComponent("Applications", isDirectory: true)
            .appendingPathComponent("Podcast Visualizer.app", isDirectory: true)

        #expect(ModelsRootResolver.resolve(
            appOwnedRoot: fixture.appOwnedModels,
            bundleURL: releaseBundle
        ) == fixture.appOwnedModels)
    }

    @Test("rejects a symlinked development model root")
    func symlinkRejection() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let realModels = fixture.root.appendingPathComponent("real-models", isDirectory: true)
        try fixture.installParakeet(at: realModels)
        try FileManager.default.createDirectory(
            at: fixture.developmentModels.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createSymbolicLink(
            at: fixture.developmentModels,
            withDestinationURL: realModels
        )

        #expect(ModelsRootResolver.resolve(
            appOwnedRoot: fixture.appOwnedModels,
            bundleURL: fixture.developmentBundle
        ) == fixture.appOwnedModels)
    }
}

private struct Fixture {
    let root: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-model-root-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    }

    var developmentBundle: URL {
        root.appendingPathComponent(".build/macos-app/Podcast Visualizer.app", isDirectory: true)
    }

    var developmentModels: URL {
        root.appendingPathComponent("models", isDirectory: true)
    }

    var appOwnedModels: URL {
        root.appendingPathComponent("Application Support/Podcast Visualizer/Models", isDirectory: true)
    }

    func installParakeet(at modelsRoot: URL) throws {
        try FileManager.default.createDirectory(
            at: modelsRoot.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true),
            withIntermediateDirectories: true
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }
}

import Foundation
import PodcastVisualizerCore

enum AppPaths {
    static func appOwnedModelsRoot(
        fileManager: FileManager = .default,
        applicationSupportDirectory: URL? = nil
    ) -> URL {
        let support = applicationSupportDirectory
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support
            .appendingPathComponent("Podcast Visualizer", isDirectory: true)
            .appendingPathComponent("Models", isDirectory: true)
            .standardizedFileURL
    }

    static func modelsRoot(
        fileManager: FileManager = .default,
        bundleURL: URL = Bundle.main.bundleURL,
        applicationSupportDirectory: URL? = nil
    ) -> URL {
        let appOwned = appOwnedModelsRoot(
            fileManager: fileManager,
            applicationSupportDirectory: applicationSupportDirectory
        )
        return ModelsRootResolver.resolve(
            appOwnedRoot: appOwned,
            bundleURL: bundleURL,
            fileManager: fileManager
        )
    }
}

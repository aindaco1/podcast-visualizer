import Foundation
import PodcastVisualizerCore

enum AppPaths {
    static func modelsRoot(
        fileManager: FileManager = .default,
        bundleURL: URL = Bundle.main.bundleURL
    ) -> URL {
        let appOwned = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcast Visualizer", isDirectory: true)
            .appendingPathComponent("Models", isDirectory: true)
            .standardizedFileURL
        return ModelsRootResolver.resolve(
            appOwnedRoot: appOwned,
            bundleURL: bundleURL,
            fileManager: fileManager
        )
    }
}

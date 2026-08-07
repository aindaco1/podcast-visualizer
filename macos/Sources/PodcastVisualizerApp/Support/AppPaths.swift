import Foundation

enum AppPaths {
    static func modelsRoot(fileManager: FileManager = .default) -> URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Podcast Visualizer", isDirectory: true)
            .appendingPathComponent("Models", isDirectory: true)
            .standardizedFileURL
    }
}

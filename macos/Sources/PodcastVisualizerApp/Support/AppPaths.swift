import Foundation
import PodcastVisualizerCore

enum AppPaths {
    static func diagnosticsDirectory(
        fileManager: FileManager = .default,
        applicationSupportDirectory: URL? = nil
    ) -> URL {
        let support = applicationSupportDirectory
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support
            .appendingPathComponent("Podcast Visualizer", isDirectory: true)
            .appendingPathComponent("Diagnostics", isDirectory: true)
            .standardizedFileURL
    }

    static func diagnosticApplicationInfo(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) -> DiagnosticApplicationInfo {
        #if arch(arm64)
        let architecture = "arm64"
        #elseif arch(x86_64)
        let architecture = "x86_64"
        #else
        let architecture = "unknown"
        #endif
        return DiagnosticApplicationInfo(
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
                ?? "development",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
                ?? "development",
            operatingSystem: processInfo.operatingSystemVersionString,
            architecture: architecture
        )
    }

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

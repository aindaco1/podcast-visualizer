import Foundation

public enum ModelsRootResolver {
    public static func resolve(
        appOwnedRoot: URL,
        bundleURL: URL,
        fileManager: FileManager = .default
    ) -> URL {
        let appOwned = appOwnedRoot.standardizedFileURL
        if containsInstalledParakeet(appOwned, fileManager: fileManager) {
            return appOwned
        }
        if let development = developmentRoot(for: bundleURL),
           containsInstalledParakeet(development, fileManager: fileManager) {
            return development
        }
        return appOwned
    }

    private static func developmentRoot(for bundleURL: URL) -> URL? {
        let bundle = bundleURL.standardizedFileURL
        guard bundle.lastPathComponent == "Podcast Visualizer.app" else { return nil }
        let appArtifacts = bundle.deletingLastPathComponent()
        guard appArtifacts.lastPathComponent == "macos-app" else { return nil }
        let build = appArtifacts.deletingLastPathComponent()
        guard build.lastPathComponent == ".build" else { return nil }
        return build.deletingLastPathComponent()
            .appendingPathComponent("models", isDirectory: true)
            .standardizedFileURL
    }

    private static func containsInstalledParakeet(_ root: URL, fileManager: FileManager) -> Bool {
        guard isRealDirectory(root, fileManager: fileManager) else { return false }
        return isRealDirectory(
            root.appendingPathComponent("parakeet-tdt-0.6b-v3", isDirectory: true),
            fileManager: fileManager
        )
    }

    private static func isRealDirectory(_ url: URL, fileManager: FileManager) -> Bool {
        let standardized = url.standardizedFileURL
        guard standardized.isFileURL,
              standardized.path.hasPrefix("/"),
              standardized.path != "/",
              standardized.resolvingSymlinksInPath() == standardized else {
            return false
        }
        var isDirectory: ObjCBool = false
        return fileManager.fileExists(atPath: standardized.path, isDirectory: &isDirectory)
            && isDirectory.boolValue
    }
}

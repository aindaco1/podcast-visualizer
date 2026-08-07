import Darwin
import Foundation

public enum ExportError: Error, Equatable, Sendable {
    case unsafeSource
    case unsafeDestination
    case unsafeFileName
    case destinationExists
}

public struct ExportCoordinator: Sendable {
    public init() {}

    public func copyVerifiedOutput(
        from source: URL,
        to destinationDirectory: URL,
        fileName: String? = nil
    ) throws -> URL {
        let manager = FileManager.default
        let sourcePath = source.standardizedFileURL.path
        let destinationRoot = destinationDirectory.standardizedFileURL.path
        guard source.isFileURL, destinationDirectory.isFileURL,
              isRegularFileWithoutSymlink(sourcePath) else {
            throw ExportError.unsafeSource
        }
        guard isDirectoryWithoutSymlink(destinationRoot) else {
            throw ExportError.unsafeDestination
        }

        let name = fileName ?? source.lastPathComponent
        guard name.range(of: #"^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$"#, options: .regularExpression) != nil,
              name != ".", name != ".." else {
            throw ExportError.unsafeFileName
        }
        let destination = destinationDirectory.appendingPathComponent(name, isDirectory: false).standardizedFileURL
        guard destination.deletingLastPathComponent() == destinationDirectory.standardizedFileURL else {
            throw ExportError.unsafeDestination
        }
        if manager.fileExists(atPath: destination.path) { throw ExportError.destinationExists }
        do {
            try manager.copyItem(at: source, to: destination)
        } catch CocoaError.fileWriteFileExists {
            throw ExportError.destinationExists
        }
        return destination
    }

    private func isRegularFileWithoutSymlink(_ path: String) -> Bool {
        var info = stat()
        return lstat(path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFREG
    }

    private func isDirectoryWithoutSymlink(_ path: String) -> Bool {
        var info = stat()
        return lstat(path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFDIR
    }
}

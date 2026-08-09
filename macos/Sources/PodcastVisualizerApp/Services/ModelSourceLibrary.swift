import Foundation

enum ModelSearchLocationKind: String, Sendable {
    case appStorage
    case downloads
    case development
    case userApproved
}

struct ModelSearchLocation: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let directory: URL
    let kind: ModelSearchLocationKind

    var isRemovable: Bool { kind == .userApproved }
    var requiresSecurityScope: Bool { kind == .userApproved }

    func candidates(for model: ExternalModel) -> [URL] {
        guard kind == .downloads || kind == .userApproved else { return [] }
        var candidates: [URL] = []
        if directory.lastPathComponent == model.folderName {
            candidates.append(directory)
        }
        candidates.append(directory.appendingPathComponent(model.folderName, isDirectory: true))
        if model == .alignment {
            candidates.append(
                directory.appendingPathComponent("alignment", isDirectory: true)
                    .appendingPathComponent(model.folderName, isDirectory: true)
            )
        }
        let conventional = directory.appendingPathComponent(
            "Podcast Visualizer Models",
            isDirectory: true
        )
        candidates.append(conventional.appendingPathComponent(model.folderName, isDirectory: true))
        if model == .alignment {
            candidates.append(
                conventional.appendingPathComponent("alignment", isDirectory: true)
                    .appendingPathComponent(model.folderName, isDirectory: true)
            )
        }
        var seen = Set<String>()
        return candidates.compactMap { candidate in
            let standardized = candidate.standardizedFileURL
            return seen.insert(standardized.path).inserted ? standardized : nil
        }
    }
}

@MainActor
protocol ModelSourceProviding: AnyObject {
    var locations: [ModelSearchLocation] { get }
    func addUserApprovedDirectory(_ directory: URL) throws
    func removeLocation(id: String)
}

enum ModelSourceLibraryError: Error, CustomStringConvertible {
    case unsafeDirectory
    case tooManyDirectories
    case bookmarkFailed

    var description: String {
        switch self {
        case .unsafeDirectory:
            "Choose a real, specific directory that is not a symbolic link."
        case .tooManyDirectories:
            "Remove an existing search location before adding another."
        case .bookmarkFailed:
            "Podcast Visualizer could not retain access to that directory."
        }
    }
}

@MainActor
final class PersistentModelSourceLibrary: ModelSourceProviding {
    private struct StoredLocation: Codable {
        let id: String
        var bookmark: Data

        private enum CodingKeys: String, CodingKey {
            case id, bookmark
        }

        init(id: String, bookmark: Data) {
            self.id = id
            self.bookmark = bookmark
        }

        init(from decoder: Decoder) throws {
            let raw = try decoder.container(keyedBy: AnyCodingKey.self)
            guard Set(raw.allKeys.map(\.stringValue)) == Set(["id", "bookmark"]) else {
                throw DecodingError.dataCorrupted(.init(
                    codingPath: decoder.codingPath,
                    debugDescription: "model search bookmark contains unexpected fields"
                ))
            }
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            bookmark = try container.decode(Data.self, forKey: .bookmark)
        }
    }

    private struct AnyCodingKey: CodingKey {
        let stringValue: String
        let intValue: Int?

        init?(stringValue: String) {
            self.stringValue = stringValue
            intValue = nil
        }

        init?(intValue: Int) {
            stringValue = String(intValue)
            self.intValue = intValue
        }
    }

    private static let storageKey = "model-search-locations-v1"
    private static let maximumLocations = 8
    private static let maximumBookmarkBytes = 64 * 1024
    private static let maximumStorageBytes = 512 * 1024

    private let defaults: UserDefaults
    private let fileManager: FileManager
    private let appOwnedRoot: URL
    private let activeModelsRoot: URL
    private let downloadsRoot: URL
    private var stored: [StoredLocation]

    init(
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        appOwnedRoot: URL? = nil,
        activeModelsRoot: URL? = nil,
        downloadsRoot: URL? = nil
    ) {
        self.defaults = defaults
        self.fileManager = fileManager
        self.appOwnedRoot = (appOwnedRoot ?? AppPaths.appOwnedModelsRoot()).standardizedFileURL
        self.activeModelsRoot = (activeModelsRoot ?? AppPaths.modelsRoot()).standardizedFileURL
        self.downloadsRoot = (
            downloadsRoot
                ?? fileManager.urls(for: .downloadsDirectory, in: .userDomainMask).first
                ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
        ).standardizedFileURL
        if let data = defaults.data(forKey: Self.storageKey),
           data.count <= Self.maximumStorageBytes,
           let value = try? JSONDecoder().decode([StoredLocation].self, from: data),
           value.count <= Self.maximumLocations {
            stored = value.filter {
                UUID(uuidString: $0.id) != nil && !$0.bookmark.isEmpty
                    && $0.bookmark.count <= Self.maximumBookmarkBytes
            }
        } else {
            stored = []
        }
    }

    var locations: [ModelSearchLocation] {
        var result = [
            ModelSearchLocation(
                id: "app-storage",
                title: "App Storage",
                directory: appOwnedRoot,
                kind: .appStorage
            ),
            ModelSearchLocation(
                id: "downloads",
                title: "Downloads",
                directory: downloadsRoot,
                kind: .downloads
            ),
        ]
        if activeModelsRoot != appOwnedRoot {
            result.append(ModelSearchLocation(
                id: "development",
                title: "Development Models",
                directory: activeModelsRoot,
                kind: .development
            ))
        }

        var changed = false
        var seen = Set(result.map { $0.directory.path })
        for index in stored.indices {
            var stale = false
            guard let resolved = try? URL(
                resolvingBookmarkData: stored[index].bookmark,
                options: [.withSecurityScope, .withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ) else {
                continue
            }
            let hasSecurityScope = resolved.startAccessingSecurityScopedResource()
            let directory = validatedDirectory(resolved)
            if stale,
               let directory,
               let refreshed = try? directory.bookmarkData(
                   options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                   includingResourceValuesForKeys: nil,
                   relativeTo: nil
               ), refreshed.count <= Self.maximumBookmarkBytes {
                stored[index].bookmark = refreshed
                changed = true
            }
            if hasSecurityScope { resolved.stopAccessingSecurityScopedResource() }
            guard let directory, seen.insert(directory.path).inserted else { continue }
            result.append(ModelSearchLocation(
                id: stored[index].id,
                title: directory.lastPathComponent,
                directory: directory,
                kind: .userApproved
            ))
        }
        if changed { persist() }
        return result
    }

    func addUserApprovedDirectory(_ directory: URL) throws {
        guard stored.count < Self.maximumLocations else {
            throw ModelSourceLibraryError.tooManyDirectories
        }
        guard let validated = validatedDirectory(directory) else {
            throw ModelSourceLibraryError.unsafeDirectory
        }
        if locations.contains(where: { $0.directory == validated }) { return }
        let bookmark: Data
        do {
            bookmark = try validated.bookmarkData(
                options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        } catch {
            throw ModelSourceLibraryError.bookmarkFailed
        }
        guard !bookmark.isEmpty, bookmark.count <= Self.maximumBookmarkBytes else {
            throw ModelSourceLibraryError.bookmarkFailed
        }
        stored.append(StoredLocation(id: UUID().uuidString, bookmark: bookmark))
        persist()
    }

    func removeLocation(id: String) {
        guard UUID(uuidString: id) != nil else { return }
        stored.removeAll { $0.id == id }
        persist()
    }

    private func validatedDirectory(_ url: URL) -> URL? {
        let standardized = url.standardizedFileURL
        let home = fileManager.homeDirectoryForCurrentUser.standardizedFileURL
        guard standardized.isFileURL, standardized.path.hasPrefix("/"),
              standardized != URL(fileURLWithPath: "/", isDirectory: true),
              standardized != home,
              standardized.resolvingSymlinksInPath() == standardized,
              let values = try? standardized.resourceValues(
                forKeys: [.isDirectoryKey, .isSymbolicLinkKey]
              ), values.isDirectory == true, values.isSymbolicLink != true else {
            return nil
        }
        return standardized
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(stored), data.count <= Self.maximumStorageBytes else {
            return
        }
        defaults.set(data, forKey: Self.storageKey)
    }
}

import Foundation

public struct ProjectBrandingLogo: Codable, Equatable, Sendable {
    public let relativePath: String
    public let path: String
    public let bytes: Int64
    public let sha256: String
    public let width: Int
    public let height: Int

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        relativePath = try container.decode(String.self, forKey: .relativePath)
        path = try container.decode(String.self, forKey: .path)
        bytes = try container.decode(Int64.self, forKey: .bytes)
        sha256 = try container.decode(String.self, forKey: .sha256)
        width = try container.decode(Int.self, forKey: .width)
        height = try container.decode(Int.self, forKey: .height)
        guard relativePath.range(
            of: #"^branding/assets/logo_[a-f0-9]{64}\.png$"#,
            options: .regularExpression
        ) != nil,
        path.hasPrefix("/"), bytes > 0, bytes <= 10 * 1024 * 1024,
        Self.isSHA256(sha256), (128...4_096).contains(width), (128...4_096).contains(height)
        else { throw ContractDecodingError.invalidValue("project branding logo") }
    }

    private static func isSHA256(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return bytes.count == 64 && bytes.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }
}

public struct ProjectBrandingWorkspace: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-project-branding-workspace-v1"

    public let schemaVersion: String
    public let projectRoot: String
    public let podcastName: String
    public let organizationName: String
    public let showSpeakerNames: Bool
    public let logo: ProjectBrandingLogo?
    public let hasSavedSettings: Bool

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        projectRoot = try container.decode(String.self, forKey: .projectRoot)
        podcastName = try container.decode(String.self, forKey: .podcastName)
        organizationName = try container.decode(String.self, forKey: .organizationName)
        showSpeakerNames = try container.decode(Bool.self, forKey: .showSpeakerNames)
        logo = try container.decodeIfPresent(ProjectBrandingLogo.self, forKey: .logo)
        hasSavedSettings = try container.decode(Bool.self, forKey: .hasSavedSettings)
        guard schemaVersion == Self.schema, projectRoot.hasPrefix("/"),
              ProjectBrandingEditing.normalizedName(podcastName) == podcastName,
              ProjectBrandingEditing.normalizedName(organizationName) == organizationName
        else { throw ContractDecodingError.invalidValue("project branding workspace") }
    }
}

public struct ProjectBrandingLogoAction: Codable, Equatable, Sendable {
    public let action: String
    public let sourcePath: String?

    public init(action: String, sourcePath: String? = nil) {
        self.action = action
        self.sourcePath = sourcePath
    }

    enum CodingKeys: String, CodingKey {
        case action, sourcePath
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(action, forKey: .action)
        if let sourcePath { try container.encode(sourcePath, forKey: .sourcePath) }
    }
}

public struct ProjectBrandingEditPayload: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-project-branding-edit-v1"

    public let schemaVersion: String
    public let podcastName: String
    public let organizationName: String
    public let showSpeakerNames: Bool
    public let logoAction: ProjectBrandingLogoAction

    public init(
        podcastName: String,
        organizationName: String,
        showSpeakerNames: Bool,
        logoAction: ProjectBrandingLogoAction
    ) {
        schemaVersion = Self.schema
        self.podcastName = podcastName
        self.organizationName = organizationName
        self.showSpeakerNames = showSpeakerNames
        self.logoAction = logoAction
    }
}

public enum ProjectBrandingEditing {
    public static func normalizedName(_ value: String) -> String? {
        let normalized = value.precomposedStringWithCanonicalMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.count <= 120,
              normalized.rangeOfCharacter(from: .controlCharacters) == nil
        else { return nil }
        return normalized
    }
}

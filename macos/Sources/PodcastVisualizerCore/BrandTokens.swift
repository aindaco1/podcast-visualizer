import Darwin
import Foundation

public enum BrandTokenError: Error, Equatable, Sendable {
    case unsafeResource
    case exceedsLimit
    case unsupportedSchema
    case unexpectedFields
    case invalidValue
}

public struct BrandTokens: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-brand-v1"

    public struct Fonts: Codable, Equatable, Sendable {
        public let transcript: String
        public let label: String
    }

    public struct Colors: Codable, Equatable, Sendable {
        public let background: String
        public let paper: String
        public let muted: String
        public let cyan: String
        public let magenta: String
    }

    public struct Speaker: Codable, Equatable, Sendable {
        public let token: String
        public let bright: String
        public let dim: String
    }

    public struct ASCII: Codable, Equatable, Sendable {
        public let glyphs: [String]
        public let waves: [String]
    }

    public let schemaVersion: String
    public let visualSystemVersion: String
    public let fonts: Fonts
    public let colors: Colors
    public let speakers: [Speaker]
    public let ascii: ASCII

    public static func load(from url: URL) throws -> BrandTokens {
        var info = stat()
        guard url.isFileURL, lstat(url.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else {
            throw BrandTokenError.unsafeResource
        }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.count <= 64 * 1024 else { throw BrandTokenError.exceedsLimit }
        return try decode(data)
    }

    public static func decode(_ data: Data) throws -> BrandTokens {
        let value = try JSONSerialization.jsonObject(with: data)
        guard let object = value as? [String: Any],
              Set(object.keys) == ["schemaVersion", "visualSystemVersion", "fonts", "colors", "speakers", "ascii"],
              let fonts = object["fonts"] as? [String: Any], Set(fonts.keys) == ["transcript", "label"],
              let colors = object["colors"] as? [String: Any], Set(colors.keys) == ["background", "paper", "muted", "cyan", "magenta"],
              let ascii = object["ascii"] as? [String: Any], Set(ascii.keys) == ["glyphs", "waves"],
              let speakers = object["speakers"] as? [[String: Any]], speakers.count == 6,
              speakers.allSatisfy({ Set($0.keys) == ["token", "bright", "dim"] }) else {
            throw BrandTokenError.unexpectedFields
        }
        let result = try JSONDecoder().decode(BrandTokens.self, from: data)
        guard result.schemaVersion == schema else { throw BrandTokenError.unsupportedSchema }
        let color = try NSRegularExpression(pattern: #"^#[A-F0-9]{6}$"#)
        let allColors = [
            result.colors.background, result.colors.paper, result.colors.muted,
            result.colors.cyan, result.colors.magenta,
        ] + result.speakers.flatMap { [$0.bright, $0.dim] }
        guard !result.visualSystemVersion.isEmpty,
              !result.fonts.transcript.isEmpty, !result.fonts.label.isEmpty,
              allColors.allSatisfy({ color.firstMatch(in: $0, range: NSRange($0.startIndex..., in: $0)) != nil }),
              result.ascii.glyphs.allSatisfy({ !$0.isEmpty && $0.count <= 2 }),
              result.ascii.waves.allSatisfy({ !$0.isEmpty && $0.count <= 120 }) else {
            throw BrandTokenError.invalidValue
        }
        return result
    }
}

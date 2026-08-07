import Foundation

public enum RenderAspect: String, CaseIterable, Codable, Sendable {
    case landscape = "16:9"
    case square = "1:1"
    case portrait = "9:16"

    public var label: String {
        switch self {
        case .landscape: "Landscape 16:9"
        case .square: "Square 1:1"
        case .portrait: "Portrait 9:16"
        }
    }
}

public enum DeliveryProfile: String, CaseIterable, Codable, Sendable {
    case opaque
    case hevcAlpha
    case proResAlpha

    public var label: String {
        switch self {
        case .opaque: "Opaque H.264"
        case .hevcAlpha: "Compact HEVC Alpha"
        case .proResAlpha: "ProRes 4444 Alpha"
        }
    }
}

public enum RenderSelectionError: Error, Equatable, Sendable {
    case missingAspect
    case missingProfile
}

public struct RenderInvocation: Equatable, Sendable {
    public let aspect: String
    public let background: String
    public let alphaCodec: String
}

public struct RenderSelection: Equatable, Sendable {
    public var aspects: Set<RenderAspect>
    public var profiles: Set<DeliveryProfile>

    public init(
        aspects: Set<RenderAspect> = [.landscape],
        profiles: Set<DeliveryProfile> = [.hevcAlpha]
    ) {
        self.aspects = aspects
        self.profiles = profiles
    }

    public func invocations() throws -> [RenderInvocation] {
        guard !aspects.isEmpty else { throw RenderSelectionError.missingAspect }
        guard !profiles.isEmpty else { throw RenderSelectionError.missingProfile }

        let aspectArguments: [String]
        if aspects == Set(RenderAspect.allCases) {
            aspectArguments = ["all"]
        } else {
            aspectArguments = RenderAspect.allCases.filter(aspects.contains).map(\.rawValue)
        }

        let profileArguments: (background: String, alphaCodec: String)
        switch profiles {
        case [.opaque]: profileArguments = ("opaque", "hevc")
        case [.hevcAlpha]: profileArguments = ("transparent", "hevc")
        case [.proResAlpha]: profileArguments = ("transparent", "prores")
        case [.opaque, .hevcAlpha]: profileArguments = ("both", "hevc")
        case [.opaque, .proResAlpha]: profileArguments = ("both", "prores")
        case [.hevcAlpha, .proResAlpha]: profileArguments = ("transparent", "both")
        case [.opaque, .hevcAlpha, .proResAlpha]: profileArguments = ("both", "both")
        default: throw RenderSelectionError.missingProfile
        }

        return aspectArguments.map {
            RenderInvocation(
                aspect: $0,
                background: profileArguments.background,
                alphaCodec: profileArguments.alphaCodec
            )
        }
    }
}

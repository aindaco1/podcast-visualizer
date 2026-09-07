import Foundation

public struct FailureDetails: Codable, Equatable, Sendable {
    public let cause: String
    public let systemCode: String?
    public let processExitCode: Int32?
    public let processSignal: String?
    public let reason: String?

    public init(cause: String, systemCode: String? = nil, processExitCode: Int32? = nil,
                processSignal: String? = nil, reason: String? = nil) {
        self.cause = cause
        self.systemCode = systemCode
        self.processExitCode = processExitCode
        self.processSignal = processSignal
        self.reason = reason
    }

    public var isValid: Bool {
        Self.causes.contains(cause)
            && (systemCode.map(Self.systemCodes.contains) ?? true)
            && (processExitCode.map { (0...255).contains($0) } ?? true)
            && (processSignal.map(Self.signals.contains) ?? true)
            && (reason.map { ["disk_full", "permission_denied", "encoder_unavailable", "encoder_initialization", "invalid_media"].contains($0) } ?? true)
    }

    public static let causes: Set<String> = ["type_error", "range_error", "syntax_error", "reference_error", "unknown",
        "process_exit", "process_signal", "process_timeout", "process_output_limit", "process_spawn",
        "helper_spawn", "helper_pipe", "helper_read", "helper_wait", "helper_output_limit", "helper_progress_limit",
        "invalid_progress", "invalid_result", "helper_busy", "invalid_models_root"]
    public static let systemCodes: Set<String> = ["ENOSPC", "EACCES", "EPERM", "ENOENT", "EIO", "EMFILE", "ENFILE", "ENOMEM", "EROFS", "EEXIST"]
    public static let signals: Set<String> = ["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGTRAP", "SIGPIPE", "SIGINT"]
}

public struct RenderProgressSnapshot: Codable, Equatable, Sendable {
    public let phase: String
    public let fraction: Double?
    public let processedMs: Double?
    public let outputIndex: Int?
    public let totalOutputs: Int?
    public let aspect: String?
    public let background: String?
    public let alphaCodec: String?

    public init?(_ detail: CLIProgressDetail) {
        guard let phase = detail.phase else { return nil }
        self.phase = phase
        fraction = detail.fraction
        processedMs = detail.processedMs
        outputIndex = detail.outputIndex
        totalOutputs = detail.totalOutputs
        aspect = detail.aspect
        background = detail.background
        alphaCodec = detail.alphaCodec
        guard isValid else { return nil }
    }

    public var isValid: Bool {
        Self.phases.contains(phase)
            && (fraction.map { $0.isFinite && (0...1).contains($0) } ?? true)
            && (processedMs.map { $0.isFinite && (0...604_800_000).contains($0) } ?? true)
            && (totalOutputs.map { (1...9).contains($0) } ?? true)
            && (outputIndex.map { $0 >= 1 && $0 <= (totalOutputs ?? 9) } ?? true)
            && (aspect.map { RenderAspect(rawValue: $0) != nil } ?? true)
            && (background.map { ["opaque", "transparent"].contains($0) } ?? true)
            && (alphaCodec.map { ["hevc", "prores"].contains($0) } ?? true)
    }

    public static let phases: Set<String> = ["runtime", "alignment", "branding", "scene", "staging", "encoding", "verifying", "reused"]
}

public struct DiagnosticContext: Codable, Equatable, Sendable {
    public let attemptID: String
    public let renderProgress: RenderProgressSnapshot?
    public let failureDetails: FailureDetails?

    public init(attemptID: String, renderProgress: RenderProgressSnapshot? = nil,
                failureDetails: FailureDetails? = nil) {
        self.attemptID = attemptID
        self.renderProgress = renderProgress
        self.failureDetails = failureDetails
    }

    public var isValid: Bool {
        UUID(uuidString: attemptID)?.uuidString.lowercased() == attemptID
            && (renderProgress?.isValid ?? true) && (failureDetails?.isValid ?? true)
    }

    static func hasOnlyKnownFields(_ value: Any) -> Bool {
        guard let object = value as? [String: Any],
              Set(object.keys).isSubset(of: ["attemptID", "renderProgress", "failureDetails"]) else { return false }
        for (key, allowed) in [
            "renderProgress": Set(["phase", "fraction", "processedMs", "outputIndex", "totalOutputs", "aspect", "background", "alphaCodec"]),
            "failureDetails": Set(["cause", "systemCode", "processExitCode", "processSignal", "reason"]),
        ] {
            if let nested = object[key], !(nested is NSNull) {
                guard let nested = nested as? [String: Any], Set(nested.keys).isSubset(of: allowed) else { return false }
            }
        }
        return true
    }
}

import Foundation

public enum ContractDecodingError: Error, Equatable, Sendable {
    case empty
    case exceedsLimit(maximumBytes: Int)
    case unsupportedSchema(expected: String, actual: String?)
    case invalidValue(String)
}

public enum ContractDecoder {
    public static func decode<Value: Decodable>(
        _ type: Value.Type,
        from data: Data,
        maximumBytes: Int = 4 * 1024 * 1024
    ) throws -> Value {
        guard !data.isEmpty else { throw ContractDecodingError.empty }
        guard data.count <= maximumBytes else {
            throw ContractDecodingError.exceedsLimit(maximumBytes: maximumBytes)
        }
        return try JSONDecoder().decode(type, from: data)
    }
}

public struct ClipWindow: Codable, Equatable, Sendable {
    public let startsAtMs: Int
    public let endsAtMs: Int
    public let durationMs: Int
}

public struct MediaProbeResult: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-media-probe-v1"

    public struct Audio: Codable, Equatable, Sendable {
        public let codec: String
        public let sampleRate: Int?
        public let channels: Int?
    }

    public let schemaVersion: String
    public let sourcePath: String
    public let bytes: Int64
    public let durationMs: Int
    public let audio: Audio

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        guard schemaVersion == Self.schema else {
            throw ContractDecodingError.unsupportedSchema(expected: Self.schema, actual: schemaVersion)
        }
        sourcePath = try container.decode(String.self, forKey: .sourcePath)
        bytes = try container.decode(Int64.self, forKey: .bytes)
        durationMs = try container.decode(Int.self, forKey: .durationMs)
        audio = try container.decode(Audio.self, forKey: .audio)
        guard sourcePath.hasPrefix("/"), bytes > 0, durationMs > 0 else {
            throw ContractDecodingError.invalidValue("media probe")
        }
    }
}

public struct InitResult: Codable, Equatable, Sendable {
    public let projectRoot: String
    public let projectId: String
    public let state: String
    public let manifestSha256: String
}

public struct StatusResult: Codable, Equatable, Sendable {
    public let projectRoot: String
    public let projectId: String
    public let state: String
    public let sourcePath: String
    public let sourceSha256: String
    public let clip: ClipWindow
    public let transcript: TranscriptSummary?

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        projectRoot = try container.decode(String.self, forKey: .projectRoot)
        projectId = try container.decode(String.self, forKey: .projectId)
        state = try container.decode(String.self, forKey: .state)
        sourcePath = try container.decode(String.self, forKey: .sourcePath)
        sourceSha256 = try container.decode(String.self, forKey: .sourceSha256)
        clip = try container.decode(ClipWindow.self, forKey: .clip)
        transcript = try container.decodeIfPresent(TranscriptSummary.self, forKey: .transcript)
        let states = Set(["initialized", "prepared", "review_required", "approved", "aligned", "verified"])
        let requiresTranscript = Set(["approved", "aligned", "verified"]).contains(state)
        guard projectRoot.hasPrefix("/"), sourcePath.hasPrefix("/"),
              projectId.range(of: #"^project_[a-f0-9]{16}_[0-9]{14}$"#, options: .regularExpression) != nil,
              states.contains(state), Self.isSHA256(sourceSha256),
              clip.startsAtMs >= 0, clip.endsAtMs > clip.startsAtMs,
              clip.durationMs == clip.endsAtMs - clip.startsAtMs,
              !requiresTranscript || transcript != nil
        else { throw ContractDecodingError.invalidValue("project status") }
    }

    private static func isSHA256(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return bytes.count == 64 && bytes.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }
}

public struct TranscriptSummary: Codable, Equatable, Sendable {
    public let words: Int
    public let speakers: Int
    public let recognizedSpeakers: Int
    public let cues: Int

    public var presentation: String {
        let speakerDescription = switch recognizedSpeakers {
        case 0:
            speakers == 1 ? "1 anonymous speaker" : "\(speakers) anonymous speakers"
        case let count where count == speakers:
            speakers == 1 ? "1 recognized speaker" : "\(speakers) recognized speakers"
        default:
            "\(speakers) speakers (\(recognizedSpeakers) recognized)"
        }
        let wordDescription = words == 1 ? "1 word" : "\(words.formatted()) words"
        let cueDescription = cues == 1 ? "1 review cue" : "\(cues) review cues"
        return "\(wordDescription) · \(speakerDescription) · \(cueDescription)"
    }

    public init(words: Int, speakers: Int, recognizedSpeakers: Int, cues: Int) {
        self.words = words
        self.speakers = speakers
        self.recognizedSpeakers = recognizedSpeakers
        self.cues = cues
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        words = try container.decode(Int.self, forKey: .words)
        speakers = try container.decode(Int.self, forKey: .speakers)
        recognizedSpeakers = try container.decode(Int.self, forKey: .recognizedSpeakers)
        cues = try container.decode(Int.self, forKey: .cues)
        guard (1...500_000).contains(words), (1...99).contains(speakers),
              (0...speakers).contains(recognizedSpeakers), (1...10_000).contains(cues)
        else { throw ContractDecodingError.invalidValue("transcript summary") }
    }
}

public struct PreparedMedia: Codable, Equatable, Sendable {
    public let relativePath: String
    public let bytes: Int64
    public let sha256: String
    public let durationMs: Int
    public let sampleRate: Int
    public let channels: Int
}

public struct PrepareResult: Codable, Equatable, Sendable {
    public let projectRoot: String
    public let analysis: PreparedMedia
    public let review: PreparedMedia
    public let analysisPath: String
    public let reviewPath: String
    public let manifestSha256: String
}

public struct AnalyzeResult: Codable, Equatable, Sendable {
    public let speechPath: String
    public let speakersPath: String
    public let draftPath: String
    public let words: Int
    public let speakers: Int
    public let cues: Int

    public var transcriptSummary: TranscriptSummary {
        TranscriptSummary(
            words: words,
            speakers: speakers,
            recognizedSpeakers: 0,
            cues: cues
        )
    }
}

public struct ReviewResult: Codable, Equatable, Sendable {
    public let reviewUrl: String
    public let state: String
    public let transcriptId: String
    public let contentSha256: String
    public let manifestSha256: String
    public let transcript: TranscriptSummary
}

public struct AlignmentQuality: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let wordCount: Int
    public let alignedWordCount: Int
    public let unalignedWordCount: Int
    public let interpolatedWordCount: Int
    public let invalidWordCount: Int
    public let projectionIssueCount: Int
    public let alignedWordRatio: Double
    public let structurallyEligible: Bool
}

public struct AlignResult: Codable, Equatable, Sendable {
    public let alignmentRevisionId: String
    public let resultPath: String
    public let qualityPath: String
    public let quality: AlignmentQuality
}

public struct RenderResult: Codable, Equatable, Sendable, Identifiable {
    public var id: String { sha256 }

    public let aspect: String
    public let background: String
    public let alphaCodec: String?
    public let videoCodec: String
    public let outputPath: String
    public let manifestPath: String
    public let sha256: String
    public let bytes: Int64
    public let durationMs: Int
    public let width: Int
    public let height: Int
    public let frameRate: Double
    public let audioCodec: String
}

public struct ModelCheck: Codable, Equatable, Sendable {
    public let id: String
    public let ok: Bool
    public let modelRoot: String?
    public let detail: String
}

public struct ModelStatusResult: Codable, Equatable, Sendable {
    public let ok: Bool
    public let checks: [ModelCheck]
}

public struct ModelImportResult: Codable, Equatable, Sendable {
    public let model: String
    public let destination: String
    public let reused: Bool
    public let version: String
}

public struct DoctorCheck: Codable, Equatable, Sendable {
    public let id: String
    public let ok: Bool
    public let detail: String
}

public struct DoctorResult: Codable, Equatable, Sendable {
    public let ok: Bool
    public let checks: [DoctorCheck]
}

public struct CLIErrorDetail: Codable, Equatable, Sendable {
    public let code: String
    public let diagnosticCode: String?
    public let message: String
    public let hint: String?
}

public struct CLIErrorResult: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-error-v1"

    public let schemaVersion: String
    public let command: String?
    public let exitCode: Int32
    public let error: CLIErrorDetail

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        guard schemaVersion == Self.schema else {
            throw ContractDecodingError.unsupportedSchema(expected: Self.schema, actual: schemaVersion)
        }
        command = try container.decodeIfPresent(String.self, forKey: .command)
        exitCode = try container.decode(Int32.self, forKey: .exitCode)
        error = try container.decode(CLIErrorDetail.self, forKey: .error)
        guard exitCode > 0, !error.code.isEmpty, !error.message.isEmpty,
              error.diagnosticCode.map({
                  guard $0.utf8.count <= 64, let first = $0.unicodeScalars.first,
                        (97...122).contains(first.value) else { return false }
                  return $0.unicodeScalars.allSatisfy {
                      (97...122).contains($0.value) || (48...57).contains($0.value) || $0.value == 95
                  }
              }) ?? true else {
            throw ContractDecodingError.invalidValue("CLI error")
        }
    }
}

public struct CLIProgressDetail: Codable, Equatable, Sendable {
    public let reviewURL: String?
    public let state: String?
    public let code: String?
    public let message: String?
    public let hint: String?
    public let phase: String?
    public let fraction: Double?
    public let processedMs: Double?
    public let outputIndex: Int?
    public let totalOutputs: Int?
    public let aspect: String?
    public let background: String?
    public let alphaCodec: String?

    enum CodingKeys: String, CodingKey {
        case reviewURL = "reviewUrl"
        case state, code, message, hint, phase, fraction, processedMs
        case outputIndex, totalOutputs, aspect, background, alphaCodec
    }

    public init(
        reviewURL: String? = nil,
        state: String? = nil,
        code: String? = nil,
        message: String? = nil,
        hint: String? = nil,
        phase: String? = nil,
        fraction: Double? = nil,
        processedMs: Double? = nil,
        outputIndex: Int? = nil,
        totalOutputs: Int? = nil,
        aspect: String? = nil,
        background: String? = nil,
        alphaCodec: String? = nil
    ) {
        self.reviewURL = reviewURL
        self.state = state
        self.code = code
        self.message = message
        self.hint = hint
        self.phase = phase
        self.fraction = fraction
        self.processedMs = processedMs
        self.outputIndex = outputIndex
        self.totalOutputs = totalOutputs
        self.aspect = aspect
        self.background = background
        self.alphaCodec = alphaCodec
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reviewURL = try container.decodeIfPresent(String.self, forKey: .reviewURL)
        state = try container.decodeIfPresent(String.self, forKey: .state)
        code = try container.decodeIfPresent(String.self, forKey: .code)
        message = try container.decodeIfPresent(String.self, forKey: .message)
        hint = try container.decodeIfPresent(String.self, forKey: .hint)
        phase = try container.decodeIfPresent(String.self, forKey: .phase)
        fraction = try container.decodeIfPresent(Double.self, forKey: .fraction)
        processedMs = try container.decodeIfPresent(Double.self, forKey: .processedMs)
        outputIndex = try container.decodeIfPresent(Int.self, forKey: .outputIndex)
        totalOutputs = try container.decodeIfPresent(Int.self, forKey: .totalOutputs)
        aspect = try container.decodeIfPresent(String.self, forKey: .aspect)
        background = try container.decodeIfPresent(String.self, forKey: .background)
        alphaCodec = try container.decodeIfPresent(String.self, forKey: .alphaCodec)
        guard phase.map({ !$0.isEmpty && $0.count <= 64 }) ?? true,
              fraction.map({ $0.isFinite && (0...1).contains($0) }) ?? true,
              processedMs.map({ $0.isFinite && $0 >= 0 }) ?? true,
              outputIndex.map({ $0 > 0 }) ?? true,
              totalOutputs.map({ $0 > 0 }) ?? true,
              outputIndex.map({ $0 <= (totalOutputs ?? $0) }) ?? true else {
            throw ContractDecodingError.invalidValue("progress detail")
        }
    }
}

public struct CLIProgressEvent: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-progress-v1"

    public let schemaVersion: String
    public let sequence: Int
    public let command: String
    public let event: String
    public let detail: CLIProgressDetail

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        guard schemaVersion == Self.schema else {
            throw ContractDecodingError.unsupportedSchema(expected: Self.schema, actual: schemaVersion)
        }
        sequence = try container.decode(Int.self, forKey: .sequence)
        command = try container.decode(String.self, forKey: .command)
        event = try container.decode(String.self, forKey: .event)
        detail = try container.decode(CLIProgressDetail.self, forKey: .detail)
        guard sequence > 0, command.count <= 64, event.count <= 64 else {
            throw ContractDecodingError.invalidValue("progress event")
        }
    }
}

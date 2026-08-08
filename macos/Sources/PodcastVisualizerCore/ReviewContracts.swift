import Foundation

private func isCanonicalSHA256(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    return bytes.count == 64 && bytes.allSatisfy {
        (48...57).contains($0) || (97...102).contains($0)
    }
}

public struct ReviewCue: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public var startsAtMs: Int
    public var endsAtMs: Int
    public var textMarkdown: String
    public var speakerLabel: String
    public var speakerConfirmed: Bool
    public var speakerConfidence: Double
    public var speakerAmbiguous: Bool

    public init(
        id: String,
        startsAtMs: Int,
        endsAtMs: Int,
        textMarkdown: String,
        speakerLabel: String,
        speakerConfirmed: Bool,
        speakerConfidence: Double,
        speakerAmbiguous: Bool
    ) {
        self.id = id
        self.startsAtMs = startsAtMs
        self.endsAtMs = endsAtMs
        self.textMarkdown = textMarkdown
        self.speakerLabel = speakerLabel
        self.speakerConfirmed = speakerConfirmed
        self.speakerConfidence = speakerConfidence
        self.speakerAmbiguous = speakerAmbiguous
    }
}

public struct ReviewWorkspace: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-review-workspace-v1"

    public let schemaVersion: String
    public let projectRoot: String
    public let draftManifestSha256: String
    public let audioPath: String
    public let durationMs: Int
    public let speakers: [String]
    public let cues: [ReviewCue]
    public let hasWorkingCopy: Bool

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        guard schemaVersion == Self.schema else {
            throw ContractDecodingError.unsupportedSchema(expected: Self.schema, actual: schemaVersion)
        }
        projectRoot = try container.decode(String.self, forKey: .projectRoot)
        draftManifestSha256 = try container.decode(String.self, forKey: .draftManifestSha256)
        audioPath = try container.decode(String.self, forKey: .audioPath)
        durationMs = try container.decode(Int.self, forKey: .durationMs)
        speakers = try container.decode([String].self, forKey: .speakers)
        cues = try container.decode([ReviewCue].self, forKey: .cues)
        hasWorkingCopy = try container.decode(Bool.self, forKey: .hasWorkingCopy)
        guard projectRoot.hasPrefix("/"), audioPath.hasPrefix("/"),
              isCanonicalSHA256(draftManifestSha256), durationMs > 0,
              (1...6).contains(speakers.count), Set(speakers).count == speakers.count,
              speakers.allSatisfy(Self.isSpeaker), (1...10_000).contains(cues.count)
        else { throw ContractDecodingError.invalidValue("review workspace") }
        var priorEnd = 0
        for cue in cues {
            guard cue.id.range(of: #"^cue_[0-9]{6}$"#, options: .regularExpression) != nil,
                  cue.startsAtMs >= priorEnd, cue.endsAtMs > cue.startsAtMs,
                  cue.endsAtMs <= durationMs, !cue.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  Self.isSpeakerOrUnknown(cue.speakerLabel),
                  cue.speakerConfidence.isFinite, (0...1).contains(cue.speakerConfidence)
            else { throw ContractDecodingError.invalidValue("review cue") }
            priorEnd = cue.endsAtMs
        }
    }

    public init(
        projectRoot: String,
        draftManifestSha256: String,
        audioPath: String,
        durationMs: Int,
        speakers: [String],
        cues: [ReviewCue],
        hasWorkingCopy: Bool
    ) {
        schemaVersion = Self.schema
        self.projectRoot = projectRoot
        self.draftManifestSha256 = draftManifestSha256
        self.audioPath = audioPath
        self.durationMs = durationMs
        self.speakers = speakers
        self.cues = cues
        self.hasWorkingCopy = hasWorkingCopy
    }

    private static func isSpeaker(_ value: String) -> Bool {
        value.range(of: #"^speaker-0[1-6]$"#, options: .regularExpression) != nil
    }

    private static func isSpeakerOrUnknown(_ value: String) -> Bool {
        value == "unknown" || isSpeaker(value)
    }
}

public struct ReviewEditPayload: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-review-edit-v1"

    public let schemaVersion: String
    public let parentDraftSha256: String
    public let cues: [ReviewCue]

    public init(parentDraftSha256: String, cues: [ReviewCue]) {
        schemaVersion = Self.schema
        self.parentDraftSha256 = parentDraftSha256
        self.cues = cues
    }
}

public struct ReviewSaveResult: Codable, Equatable, Sendable {
    public let ok: Bool
    public let workingSha256: String

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decode(Bool.self, forKey: .ok)
        workingSha256 = try container.decode(String.self, forKey: .workingSha256)
        guard ok, isCanonicalSHA256(workingSha256)
        else { throw ContractDecodingError.invalidValue("review save result") }
    }
}

public struct NativeReviewApprovalResult: Codable, Equatable, Sendable {
    public let state: String
    public let transcriptId: String
    public let contentSha256: String
    public let manifestSha256: String

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(String.self, forKey: .state)
        transcriptId = try container.decode(String.self, forKey: .transcriptId)
        contentSha256 = try container.decode(String.self, forKey: .contentSha256)
        manifestSha256 = try container.decode(String.self, forKey: .manifestSha256)
        guard state == "approved",
              transcriptId.range(of: #"^transcript_[a-f0-9]{24}$"#, options: .regularExpression) != nil,
              [contentSha256, manifestSha256].allSatisfy(isCanonicalSHA256)
        else { throw ContractDecodingError.invalidValue("native review approval") }
    }
}

public struct ReviewReplacementResult: Equatable, Sendable {
    public let cues: [ReviewCue]
    public let replacements: Int
}

public enum ReviewEditing {
    public static func mergeNext(at index: Int, in cues: [ReviewCue]) -> [ReviewCue] {
        guard cues.indices.contains(index), cues.indices.contains(index + 1) else { return cues }
        let left = cues[index]
        let right = cues[index + 1]
        var merged = left
        merged.endsAtMs = right.endsAtMs
        merged.textMarkdown = "\(left.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)) \(right.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines))"
        merged.speakerConfirmed = left.speakerConfirmed
            && right.speakerConfirmed
            && left.speakerLabel == right.speakerLabel
        merged.speakerAmbiguous = left.speakerLabel != right.speakerLabel
        var result = cues
        result.replaceSubrange(index...(index + 1), with: [merged])
        return result
    }

    public static func mergeSpeaker(
        _ source: String,
        into target: String,
        in cues: [ReviewCue]
    ) -> [ReviewCue] {
        guard source != target else { return cues }
        return cues.map { cue in
            guard cue.speakerLabel == source else { return cue }
            var edited = cue
            edited.speakerLabel = target
            edited.speakerConfirmed = true
            edited.speakerAmbiguous = false
            return edited
        }
    }

    public static func replaceAll(
        _ search: String,
        with replacement: String,
        in cues: [ReviewCue],
        caseSensitive: Bool,
        wholeWords: Bool
    ) -> ReviewReplacementResult {
        guard !search.isEmpty else { return ReviewReplacementResult(cues: cues, replacements: 0) }
        let escaped = NSRegularExpression.escapedPattern(for: search)
        let word = #"[\p{L}\p{N}_]"#
        let pattern = wholeWords ? "(?<!\(word))\(escaped)(?!\(word))" : escaped
        guard let expression = try? NSRegularExpression(
            pattern: pattern,
            options: caseSensitive ? [] : [.caseInsensitive]
        ) else { return ReviewReplacementResult(cues: cues, replacements: 0) }
        var count = 0
        let edited = cues.map { cue in
            let source = cue.textMarkdown
            let fullRange = NSRange(source.startIndex..<source.endIndex, in: source)
            let matches = expression.matches(in: source, range: fullRange)
            guard !matches.isEmpty else { return cue }
            var text = source
            for match in matches.reversed() {
                guard let range = Range(match.range, in: text) else { continue }
                text.replaceSubrange(range, with: replacement)
            }
            count += matches.count
            var copy = cue
            copy.textMarkdown = text
            return copy
        }
        return ReviewReplacementResult(cues: edited, replacements: count)
    }
}

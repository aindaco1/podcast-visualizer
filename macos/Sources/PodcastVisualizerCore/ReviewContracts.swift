import Foundation

private func isCanonicalSHA256(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    return bytes.count == 64 && bytes.allSatisfy {
        (48...57).contains($0) || (97...102).contains($0)
    }
}

private func isTranscriptID(_ value: String) -> Bool {
    value.range(of: #"^transcript_[a-f0-9]{24}$"#, options: .regularExpression) != nil
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

public struct ReviewSpeaker: Codable, Equatable, Identifiable, Sendable {
    public static let maximumCount = 99

    public let id: String
    public var displayName: String

    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        displayName = try container.decode(String.self, forKey: .displayName)
        guard Self.isID(id), ReviewEditing.normalizedSpeakerDisplayName(displayName) == displayName
        else { throw ContractDecodingError.invalidValue("review speaker") }
    }

    static func isID(_ value: String) -> Bool {
        value.range(of: #"^speaker-(?:0[1-9]|[1-9][0-9])$"#, options: .regularExpression) != nil
    }
}

public struct ReviewWorkspace: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-review-workspace-v3"

    public let schemaVersion: String
    public let projectRoot: String
    public let draftManifestSha256: String
    public let baseTranscriptId: String?
    public let baseRevisionSha256: String?
    public let audioPath: String
    public let durationMs: Int
    public let speakers: [ReviewSpeaker]
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
        baseTranscriptId = try container.decodeIfPresent(String.self, forKey: .baseTranscriptId)
        baseRevisionSha256 = try container.decodeIfPresent(String.self, forKey: .baseRevisionSha256)
        audioPath = try container.decode(String.self, forKey: .audioPath)
        durationMs = try container.decode(Int.self, forKey: .durationMs)
        speakers = try container.decode([ReviewSpeaker].self, forKey: .speakers)
        cues = try container.decode([ReviewCue].self, forKey: .cues)
        hasWorkingCopy = try container.decode(Bool.self, forKey: .hasWorkingCopy)
        guard container.contains(.baseTranscriptId), container.contains(.baseRevisionSha256),
              projectRoot.hasPrefix("/"), audioPath.hasPrefix("/"),
              isCanonicalSHA256(draftManifestSha256), durationMs > 0,
              (baseTranscriptId == nil) == (baseRevisionSha256 == nil),
              baseTranscriptId.map(isTranscriptID) ?? true,
              baseRevisionSha256.map(isCanonicalSHA256) ?? true,
              (0...ReviewSpeaker.maximumCount).contains(speakers.count),
              Set(speakers.map(\.id)).count == speakers.count,
              (1...10_000).contains(cues.count)
        else { throw ContractDecodingError.invalidValue("review workspace") }
        let speakerIDs = Set(speakers.map(\.id))
        var priorEnd = 0
        for cue in cues {
            guard cue.id.range(of: #"^cue_[0-9]{6}$"#, options: .regularExpression) != nil,
                  cue.startsAtMs >= priorEnd, cue.endsAtMs > cue.startsAtMs,
                  cue.endsAtMs <= durationMs, !cue.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  cue.speakerLabel == "unknown" || speakerIDs.contains(cue.speakerLabel),
                  cue.speakerConfidence.isFinite, (0...1).contains(cue.speakerConfidence)
            else { throw ContractDecodingError.invalidValue("review cue") }
            priorEnd = cue.endsAtMs
        }
    }

    public init(
        projectRoot: String,
        draftManifestSha256: String,
        baseTranscriptId: String? = nil,
        baseRevisionSha256: String? = nil,
        audioPath: String,
        durationMs: Int,
        speakers: [ReviewSpeaker],
        cues: [ReviewCue],
        hasWorkingCopy: Bool
    ) {
        schemaVersion = Self.schema
        self.projectRoot = projectRoot
        self.draftManifestSha256 = draftManifestSha256
        self.baseTranscriptId = baseTranscriptId
        self.baseRevisionSha256 = baseRevisionSha256
        self.audioPath = audioPath
        self.durationMs = durationMs
        self.speakers = speakers
        self.cues = cues
        self.hasWorkingCopy = hasWorkingCopy
    }
}

public struct ReviewEditPayload: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-review-edit-v3"

    public let schemaVersion: String
    public let parentDraftSha256: String
    public let baseTranscriptId: String?
    public let baseRevisionSha256: String?
    public let speakers: [ReviewSpeaker]
    public let cues: [ReviewCue]

    public init(
        parentDraftSha256: String,
        baseTranscriptId: String?,
        baseRevisionSha256: String?,
        speakers: [ReviewSpeaker],
        cues: [ReviewCue]
    ) {
        schemaVersion = Self.schema
        self.parentDraftSha256 = parentDraftSha256
        self.baseTranscriptId = baseTranscriptId
        self.baseRevisionSha256 = baseRevisionSha256
        self.speakers = speakers
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

public struct ReviewTextMatch: Equatable, Hashable, Identifiable, Sendable {
    public let cueID: String
    public let utf16Location: Int
    public let utf16Length: Int

    public var id: String { "\(cueID):\(utf16Location):\(utf16Length)" }
    public var utf16Range: NSRange {
        NSRange(location: utf16Location, length: utf16Length)
    }

    public init(cueID: String, utf16Location: Int, utf16Length: Int) {
        self.cueID = cueID
        self.utf16Location = utf16Location
        self.utf16Length = utf16Length
    }
}

public struct ReviewSpeakerDeletionResult: Equatable, Sendable {
    public let speakers: [ReviewSpeaker]
    public let cues: [ReviewCue]
    public let reassignedCueCount: Int
}

public enum ReviewEditing {
    private static let maximumSearchLength = 1_024
    private static let maximumMatches = 1_000_000

    public static func normalizedSpeakerDisplayName(_ value: String) -> String? {
        let normalized = value.precomposedStringWithCanonicalMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.count <= 60,
              normalized.rangeOfCharacter(from: .controlCharacters) == nil
        else { return nil }
        return normalized
    }

    public static func addSpeaker(to speakers: [ReviewSpeaker]) -> [ReviewSpeaker]? {
        guard speakers.count < ReviewSpeaker.maximumCount else { return nil }
        let existing = Set(speakers.map(\.id))
        guard let number = (1...ReviewSpeaker.maximumCount).first(where: {
            !existing.contains(String(format: "speaker-%02d", $0))
        })
        else { return nil }
        return speakers + [ReviewSpeaker(
            id: String(format: "speaker-%02d", number),
            displayName: "Speaker \(number)"
        )]
    }

    public static func renameSpeaker(
        _ id: String,
        to displayName: String,
        in speakers: [ReviewSpeaker]
    ) -> [ReviewSpeaker]? {
        guard let name = normalizedSpeakerDisplayName(displayName),
              speakers.contains(where: { $0.id == id })
        else { return nil }
        return speakers.map { speaker in
            guard speaker.id == id else { return speaker }
            var renamed = speaker
            renamed.displayName = name
            return renamed
        }
    }

    public static func deleteSpeaker(
        _ id: String,
        from speakers: [ReviewSpeaker],
        cues: [ReviewCue]
    ) -> ReviewSpeakerDeletionResult? {
        guard speakers.contains(where: { $0.id == id }) else { return nil }
        var reassignedCueCount = 0
        let reassigned = cues.map { cue in
            guard cue.speakerLabel == id else { return cue }
            reassignedCueCount += 1
            var updated = cue
            updated.speakerLabel = "unknown"
            updated.speakerConfirmed = false
            updated.speakerAmbiguous = true
            return updated
        }
        return ReviewSpeakerDeletionResult(
            speakers: speakers.filter { $0.id != id },
            cues: reassigned,
            reassignedCueCount: reassignedCueCount
        )
    }

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
        let found = matches(
            search,
            in: cues,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        )
        return replacing(found, with: replacement, in: cues)
    }

    public static func matches(
        _ search: String,
        in cues: [ReviewCue],
        caseSensitive: Bool,
        wholeWords: Bool
    ) -> [ReviewTextMatch] {
        guard let expression = searchExpression(
            search,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        ) else { return [] }
        var found: [ReviewTextMatch] = []
        found.reserveCapacity(min(cues.count, 1_024))
        for cue in cues {
            let source = cue.textMarkdown
            let fullRange = NSRange(source.startIndex..<source.endIndex, in: source)
            for match in expression.matches(in: source, range: fullRange) {
                guard match.range.length > 0 else { continue }
                found.append(ReviewTextMatch(
                    cueID: cue.id,
                    utf16Location: match.range.location,
                    utf16Length: match.range.length
                ))
                if found.count >= maximumMatches { return [] }
            }
        }
        return found
    }

    public static func replace(
        _ match: ReviewTextMatch,
        search: String,
        with replacement: String,
        in cues: [ReviewCue],
        caseSensitive: Bool,
        wholeWords: Bool
    ) -> ReviewReplacementResult {
        let current = matches(
            search,
            in: cues,
            caseSensitive: caseSensitive,
            wholeWords: wholeWords
        )
        guard current.contains(match) else {
            return ReviewReplacementResult(cues: cues, replacements: 0)
        }
        return replacing([match], with: replacement, in: cues)
    }

    public static func navigatedMatchIndex(
        current: Int?,
        count: Int,
        direction: Int
    ) -> Int? {
        guard count > 0 else { return nil }
        let index = current.map { min(max(0, $0), count - 1) }
            ?? (direction < 0 ? 0 : count - 1)
        return (index + (direction < 0 ? -1 : 1) + count) % count
    }

    private static func searchExpression(
        _ search: String,
        caseSensitive: Bool,
        wholeWords: Bool
    ) -> NSRegularExpression? {
        guard !search.isEmpty, search.count <= maximumSearchLength,
              !search.unicodeScalars.contains(where: {
                  $0.value < 0x20 || (0x7f...0x9f).contains($0.value)
              })
        else { return nil }
        let escaped = NSRegularExpression.escapedPattern(for: search)
        let word = #"[\p{L}\p{N}_]"#
        let pattern = wholeWords ? "(?<!\(word))\(escaped)(?!\(word))" : escaped
        return try? NSRegularExpression(
            pattern: pattern,
            options: caseSensitive ? [] : [.caseInsensitive]
        )
    }

    private static func replacing(
        _ matches: [ReviewTextMatch],
        with replacement: String,
        in cues: [ReviewCue]
    ) -> ReviewReplacementResult {
        guard !matches.isEmpty else {
            return ReviewReplacementResult(cues: cues, replacements: 0)
        }
        let grouped = Dictionary(grouping: matches, by: \.cueID)
        var replacementCount = 0
        let edited = cues.map { cue in
            guard let cueMatches = grouped[cue.id] else { return cue }
            var text = cue.textMarkdown
            for descriptor in cueMatches.sorted(by: {
                $0.utf16Location > $1.utf16Location
            }) {
                guard let range = Range(descriptor.utf16Range, in: text) else { continue }
                text.replaceSubrange(range, with: replacement)
                replacementCount += 1
            }
            var copy = cue
            copy.textMarkdown = text
            return copy
        }
        return ReviewReplacementResult(cues: edited, replacements: replacementCount)
    }
}

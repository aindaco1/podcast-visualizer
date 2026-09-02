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

public enum ReviewRecognitionConfidenceTier: String, Codable, CaseIterable, Sendable {
    case ultraLow
    case low
    case medium
    case high
    case unavailable

    public var label: String {
        switch self {
        case .ultraLow: "Ultra Low"
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        case .unavailable: "Unavailable"
        }
    }
}

public struct ReviewRecognitionConfidenceThresholds: Codable, Equatable, Sendable {
    public let ultraLowBelow: Double
    public let lowBelow: Double
    public let mediumBelow: Double

    public init(ultraLowBelow: Double, lowBelow: Double, mediumBelow: Double) {
        self.ultraLowBelow = ultraLowBelow
        self.lowBelow = lowBelow
        self.mediumBelow = mediumBelow
    }

    public func tier(for score: Double?) -> ReviewRecognitionConfidenceTier {
        guard let score else { return .unavailable }
        if score < ultraLowBelow { return .ultraLow }
        if score < lowBelow { return .low }
        if score < mediumBelow { return .medium }
        return .high
    }

    fileprivate var isValid: Bool {
        [ultraLowBelow, lowBelow, mediumBelow].allSatisfy {
            $0.isFinite && (0...1).contains($0)
        } && ultraLowBelow > 0
            && ultraLowBelow < lowBelow
            && lowBelow < mediumBelow
    }
}

public struct ReviewRecognitionTokenEvidence: Codable, Equatable, Sendable {
    public let startsAtMs: Int
    public let endsAtMs: Int
    public let score: Double

    public init(startsAtMs: Int, endsAtMs: Int, score: Double) {
        self.startsAtMs = startsAtMs
        self.endsAtMs = endsAtMs
        self.score = score
    }
}

public struct ReviewCueRecognitionConfidence: Codable, Equatable, Sendable {
    public let cueId: String
    public let tier: ReviewRecognitionConfidenceTier
    public let score: Double?
    public let tokenCount: Int
    public let tokenEvidence: [ReviewRecognitionTokenEvidence]

    public init(
        cueId: String,
        tier: ReviewRecognitionConfidenceTier,
        score: Double?,
        tokenCount: Int,
        tokenEvidence: [ReviewRecognitionTokenEvidence]
    ) {
        self.cueId = cueId
        self.tier = tier
        self.score = score
        self.tokenCount = tokenCount
        self.tokenEvidence = tokenEvidence
    }
}

public struct ReviewRecognitionConfidence: Codable, Equatable, Sendable {
    public static let schema = "timed-text-recognition-confidence-v1"
    public static let policy = "parakeet-spoken-token-minimum-v1"

    public let schemaVersion: String
    public let policyVersion: String
    public let thresholds: ReviewRecognitionConfidenceThresholds
    public let cues: [ReviewCueRecognitionConfidence]

    public init(
        thresholds: ReviewRecognitionConfidenceThresholds,
        cues: [ReviewCueRecognitionConfidence]
    ) {
        schemaVersion = Self.schema
        policyVersion = Self.policy
        self.thresholds = thresholds
        self.cues = cues
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        policyVersion = try container.decode(String.self, forKey: .policyVersion)
        thresholds = try container.decode(
            ReviewRecognitionConfidenceThresholds.self,
            forKey: .thresholds
        )
        cues = try container.decode([ReviewCueRecognitionConfidence].self, forKey: .cues)
        guard schemaVersion == Self.schema, policyVersion == Self.policy,
              thresholds.isValid, cues.count <= 10_000
        else { throw ContractDecodingError.invalidValue("review recognition confidence") }
        var cueIDs = Set<String>()
        var totalTokenEvidence = 0
        for cue in cues {
            let (updatedEvidenceCount, overflowed) = totalTokenEvidence.addingReportingOverflow(
                cue.tokenEvidence.count
            )
            let evidenceScore = cue.tokenEvidence.map(\.score).min()
            guard cue.cueId.range(of: #"^cue_[0-9]{6}$"#, options: .regularExpression) != nil,
                  cueIDs.insert(cue.cueId).inserted,
                  cue.tokenCount == cue.tokenEvidence.count,
                  !overflowed, updatedEvidenceCount <= 20_000,
                  cue.score.map({ $0.isFinite && (0...1).contains($0) }) ?? true,
                  cue.tier == thresholds.tier(for: cue.score),
                  evidenceScore == nil || cue.score == evidenceScore,
                  cue.tokenEvidence.allSatisfy({ token in
                      token.startsAtMs >= 0 && token.endsAtMs > token.startsAtMs
                          && token.score.isFinite && (0...1).contains(token.score)
                  })
            else { throw ContractDecodingError.invalidValue("review recognition confidence cue") }
            totalTokenEvidence = updatedEvidenceCount
        }
    }

    public func confidence(for cueID: ReviewCue.ID) -> ReviewCueRecognitionConfidence? {
        cues.first(where: { $0.cueId == cueID })
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
    public static let schema = "podcast-visualizer-review-workspace-v4"

    public let schemaVersion: String
    public let projectRoot: String
    public let draftManifestSha256: String
    public let baseTranscriptId: String?
    public let baseRevisionSha256: String?
    public let audioPath: String
    public let durationMs: Int
    public let speakers: [ReviewSpeaker]
    public let cues: [ReviewCue]
    public let checkedCueIds: [String]
    public let editedCueIds: [String]
    public let recognitionConfidence: ReviewRecognitionConfidence
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
        checkedCueIds = try container.decode([String].self, forKey: .checkedCueIds)
        editedCueIds = try container.decode([String].self, forKey: .editedCueIds)
        recognitionConfidence = try container.decode(
            ReviewRecognitionConfidence.self,
            forKey: .recognitionConfidence
        )
        hasWorkingCopy = try container.decode(Bool.self, forKey: .hasWorkingCopy)
        guard container.contains(.baseTranscriptId), container.contains(.baseRevisionSha256),
              projectRoot.hasPrefix("/"), audioPath.hasPrefix("/"),
              isCanonicalSHA256(draftManifestSha256), durationMs > 0,
              (baseTranscriptId == nil) == (baseRevisionSha256 == nil),
              baseTranscriptId.map(isTranscriptID) ?? true,
              baseRevisionSha256.map(isCanonicalSHA256) ?? true,
              (0...ReviewSpeaker.maximumCount).contains(speakers.count),
              Set(speakers.map(\.id)).count == speakers.count,
              (1...10_000).contains(cues.count),
              Set(checkedCueIds).count == checkedCueIds.count,
              Set(editedCueIds).count == editedCueIds.count,
              recognitionConfidence.cues.count == cues.count
        else { throw ContractDecodingError.invalidValue("review workspace") }
        let speakerIDs = Set(speakers.map(\.id))
        var cueIDs = Set<String>()
        let checkedIDs = Set(checkedCueIds)
        let editedIDs = Set(editedCueIds)
        let confidenceIDs = Set(recognitionConfidence.cues.map(\.cueId))
        var priorEnd = 0
        for cue in cues {
            guard cue.id.range(of: #"^cue_[0-9]{6}$"#, options: .regularExpression) != nil,
                  cueIDs.insert(cue.id).inserted,
                  cue.startsAtMs >= priorEnd, cue.endsAtMs > cue.startsAtMs,
                  cue.endsAtMs <= durationMs, !cue.textMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  cue.speakerLabel == "unknown" || speakerIDs.contains(cue.speakerLabel),
                  cue.speakerConfidence.isFinite, (0...1).contains(cue.speakerConfidence)
            else { throw ContractDecodingError.invalidValue("review cue") }
            priorEnd = cue.endsAtMs
        }
        guard checkedIDs.isSubset(of: cueIDs), editedIDs.isSubset(of: cueIDs), confidenceIDs == cueIDs else {
            throw ContractDecodingError.invalidValue("review workspace cue evidence")
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
        checkedCueIds: [String] = [],
        editedCueIds: [String] = [],
        recognitionConfidence: ReviewRecognitionConfidence? = nil,
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
        self.checkedCueIds = checkedCueIds
        self.editedCueIds = editedCueIds
        self.recognitionConfidence = recognitionConfidence ?? ReviewRecognitionConfidence(
            thresholds: ReviewRecognitionConfidenceThresholds(
                ultraLowBelow: 0.5,
                lowBelow: 0.9,
                mediumBelow: 0.98
            ),
            cues: cues.map {
                ReviewCueRecognitionConfidence(
                    cueId: $0.id,
                    tier: .unavailable,
                    score: nil,
                    tokenCount: 0,
                    tokenEvidence: []
                )
            }
        )
        self.hasWorkingCopy = hasWorkingCopy
    }
}

public enum ReviewReflowBoundaryAction: String, Codable, Equatable, Sendable {
    case merge
    case keep
}

public struct ReviewReflowBoundaryHint: Codable, Equatable, Sendable {
    public let afterCueId: String
    public let action: ReviewReflowBoundaryAction

    public init(afterCueId: String, action: ReviewReflowBoundaryAction) {
        self.afterCueId = afterCueId
        self.action = action
    }
}

public struct ReviewEditPayload: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-review-edit-v5"

    public let schemaVersion: String
    public let parentDraftSha256: String
    public let baseTranscriptId: String?
    public let baseRevisionSha256: String?
    public let speakers: [ReviewSpeaker]
    public let cues: [ReviewCue]
    public let reflowBoundaryHints: [ReviewReflowBoundaryHint]
    public let checkedCueIds: [String]

    public init(
        parentDraftSha256: String,
        baseTranscriptId: String?,
        baseRevisionSha256: String?,
        speakers: [ReviewSpeaker],
        cues: [ReviewCue],
        reflowBoundaryHints: [ReviewReflowBoundaryHint] = [],
        checkedCueIds: [String] = []
    ) {
        schemaVersion = Self.schema
        self.parentDraftSha256 = parentDraftSha256
        self.baseTranscriptId = baseTranscriptId
        self.baseRevisionSha256 = baseRevisionSha256
        self.speakers = speakers
        self.cues = cues
        self.reflowBoundaryHints = reflowBoundaryHints
        self.checkedCueIds = checkedCueIds
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(parentDraftSha256, forKey: .parentDraftSha256)
        if let baseTranscriptId {
            try container.encode(baseTranscriptId, forKey: .baseTranscriptId)
        } else {
            try container.encodeNil(forKey: .baseTranscriptId)
        }
        if let baseRevisionSha256 {
            try container.encode(baseRevisionSha256, forKey: .baseRevisionSha256)
        } else {
            try container.encodeNil(forKey: .baseRevisionSha256)
        }
        try container.encode(speakers, forKey: .speakers)
        try container.encode(cues, forKey: .cues)
        try container.encode(reflowBoundaryHints, forKey: .reflowBoundaryHints)
        try container.encode(checkedCueIds, forKey: .checkedCueIds)
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
    public let transcript: TranscriptSummary

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(String.self, forKey: .state)
        transcriptId = try container.decode(String.self, forKey: .transcriptId)
        contentSha256 = try container.decode(String.self, forKey: .contentSha256)
        manifestSha256 = try container.decode(String.self, forKey: .manifestSha256)
        transcript = try container.decode(TranscriptSummary.self, forKey: .transcript)
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

public enum ReviewSplitFailure: Error, Equatable, Sendable {
    case cueMissing
    case cueLimitReached
    case cueIdentityExhausted
    case unsafePlayhead
    case invalidTextBoundary
}

public struct ReviewSplitResult: Equatable, Sendable {
    public let cues: [ReviewCue]
    public let leftCueID: ReviewCue.ID
    public let rightCueID: ReviewCue.ID
}

public extension ReviewRecognitionConfidence {
    func splitting(
        cueID: ReviewCue.ID,
        rightCueID: ReviewCue.ID,
        at playheadMs: Int
    ) -> ReviewRecognitionConfidence {
        guard let index = cues.firstIndex(where: { $0.cueId == cueID }) else { return self }
        let source = cues[index]
        var leftTokens: [ReviewRecognitionTokenEvidence] = []
        var rightTokens: [ReviewRecognitionTokenEvidence] = []
        for token in source.tokenEvidence {
            if token.endsAtMs <= playheadMs {
                leftTokens.append(token)
            } else if token.startsAtMs >= playheadMs {
                rightTokens.append(token)
            } else {
                let leftOverlap = playheadMs - token.startsAtMs
                let rightOverlap = token.endsAtMs - playheadMs
                if leftOverlap >= rightOverlap { leftTokens.append(token) }
                else { rightTokens.append(token) }
            }
        }
        let left = compiled(
            cueID: cueID,
            tokens: leftTokens,
            fallback: source
        )
        let right = compiled(
            cueID: rightCueID,
            tokens: rightTokens,
            fallback: source
        )
        var result = cues
        result.replaceSubrange(index...index, with: [left, right])
        return ReviewRecognitionConfidence(thresholds: thresholds, cues: result)
    }

    func merging(
        leftCueID: ReviewCue.ID,
        rightCueID: ReviewCue.ID
    ) -> ReviewRecognitionConfidence {
        guard let leftIndex = cues.firstIndex(where: { $0.cueId == leftCueID }),
              cues.indices.contains(leftIndex + 1),
              cues[leftIndex + 1].cueId == rightCueID
        else { return self }
        let left = cues[leftIndex]
        let right = cues[leftIndex + 1]
        let tokens = (left.tokenEvidence + right.tokenEvidence).sorted {
            ($0.startsAtMs, $0.endsAtMs) < ($1.startsAtMs, $1.endsAtMs)
        }
        let fallbackScore = [left.score, right.score].compactMap { $0 }.min()
        let fallback = ReviewCueRecognitionConfidence(
            cueId: leftCueID,
            tier: thresholds.tier(for: fallbackScore),
            score: fallbackScore,
            tokenCount: 0,
            tokenEvidence: []
        )
        let merged = compiled(cueID: leftCueID, tokens: tokens, fallback: fallback)
        var result = cues
        result.replaceSubrange(leftIndex...(leftIndex + 1), with: [merged])
        return ReviewRecognitionConfidence(thresholds: thresholds, cues: result)
    }

    private func compiled(
        cueID: ReviewCue.ID,
        tokens: [ReviewRecognitionTokenEvidence],
        fallback: ReviewCueRecognitionConfidence
    ) -> ReviewCueRecognitionConfidence {
        guard !tokens.isEmpty else {
            return ReviewCueRecognitionConfidence(
                cueId: cueID,
                tier: fallback.tier,
                score: fallback.score,
                tokenCount: 0,
                tokenEvidence: []
            )
        }
        let score = tokens.reduce(1.0) { min($0, $1.score) }
        return ReviewCueRecognitionConfidence(
            cueId: cueID,
            tier: thresholds.tier(for: score),
            score: score,
            tokenCount: tokens.count,
            tokenEvidence: tokens
        )
    }
}

public enum ReviewEditing {
    private static let maximumSearchLength = 1_024
    private static let maximumMatches = 1_000_000
    private static let splitSafetyMarginMs = 150

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

    public static func mergeNext(cueID: ReviewCue.ID, in cues: [ReviewCue]) -> [ReviewCue] {
        guard let index = cues.firstIndex(where: { $0.id == cueID }) else { return cues }
        return mergeNext(at: index, in: cues)
    }

    public static func mergePrevious(cueID: ReviewCue.ID, in cues: [ReviewCue]) -> [ReviewCue] {
        guard let index = cues.firstIndex(where: { $0.id == cueID }), index > 0 else { return cues }
        return mergeNext(at: index - 1, in: cues)
    }

    public static func splitCue(
        cueID: ReviewCue.ID,
        at playheadMs: Int,
        textBoundaryUTF16Offset: Int,
        in cues: [ReviewCue]
    ) -> Result<ReviewSplitResult, ReviewSplitFailure> {
        guard let index = cues.firstIndex(where: { $0.id == cueID }) else {
            return .failure(.cueMissing)
        }
        guard cues.count < 10_000 else { return .failure(.cueLimitReached) }
        let cue = cues[index]
        guard playheadMs - cue.startsAtMs >= splitSafetyMarginMs,
              cue.endsAtMs - playheadMs >= splitSafetyMarginMs
        else { return .failure(.unsafePlayhead) }

        let text = cue.textMarkdown
        guard textBoundaryUTF16Offset > 0,
              textBoundaryUTF16Offset < text.utf16.count
        else { return .failure(.invalidTextBoundary) }
        let utf16Index = text.utf16.index(
            text.utf16.startIndex,
            offsetBy: textBoundaryUTF16Offset
        )
        guard let boundary = String.Index(utf16Index, within: text),
              text.indices.contains(boundary)
        else { return .failure(.invalidTextBoundary) }
        let rawLeft = text[..<boundary]
        let rawRight = text[boundary...]
        guard rawLeft.last?.isWhitespace == true || rawRight.first?.isWhitespace == true
        else { return .failure(.invalidTextBoundary) }
        let leftText = rawLeft.trimmingCharacters(in: .whitespacesAndNewlines)
        let rightText = rawRight.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !leftText.isEmpty, !rightText.isEmpty else {
            return .failure(.invalidTextBoundary)
        }

        let existing = Set(cues.map(\.id))
        guard let number = (1...999_999).first(where: {
            !existing.contains(String(format: "cue_%06d", $0))
        }) else { return .failure(.cueIdentityExhausted) }
        let rightCueID = String(format: "cue_%06d", number)
        var left = cue
        left.endsAtMs = playheadMs
        left.textMarkdown = leftText
        let right = ReviewCue(
            id: rightCueID,
            startsAtMs: playheadMs,
            endsAtMs: cue.endsAtMs,
            textMarkdown: rightText,
            speakerLabel: cue.speakerLabel,
            speakerConfirmed: cue.speakerConfirmed,
            speakerConfidence: cue.speakerConfidence,
            speakerAmbiguous: cue.speakerAmbiguous
        )
        var result = cues
        result.replaceSubrange(index...index, with: [left, right])
        return .success(ReviewSplitResult(
            cues: result,
            leftCueID: cue.id,
            rightCueID: rightCueID
        ))
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

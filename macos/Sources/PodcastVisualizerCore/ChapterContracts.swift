import Foundation

private struct ChapterCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil

    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

private func rejectUnexpectedChapterFields(
    _ decoder: Decoder,
    allowed: Set<String>,
    label: String
) throws {
    let container = try decoder.container(keyedBy: ChapterCodingKey.self)
    guard Set(container.allKeys.map(\.stringValue)) == allowed else {
        throw ContractDecodingError.invalidValue("\(label) fields")
    }
}

public enum ChapterMode: String, Codable, CaseIterable, Equatable, Sendable {
    case topics
    case questions
}

private func isChapterSHA256(_ value: String) -> Bool {
    value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
}

private func isChapterContextID(_ value: String) -> Bool {
    value.range(of: #"^chapter_context_[a-f0-9]{24}$"#, options: .regularExpression) != nil
}

private func isChapterRevisionID(_ value: String) -> Bool {
    value.range(of: #"^chapters_[a-f0-9]{24}$"#, options: .regularExpression) != nil
}

private func isChapterAnchorID(_ value: String) -> Bool {
    value.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#, options: .regularExpression) != nil
}

private func isSafeChapterDraftTitle(_ value: String, maximum: Int) -> Bool {
    value.count <= maximum
        && value.precomposedStringWithCanonicalMapping == value
        && value.rangeOfCharacter(from: .controlCharacters) == nil
        && value.range(
            of: #"[\u{202A}-\u{202E}\u{2066}-\u{2069}]"#,
            options: .regularExpression
        ) == nil
}

private func isSafeChapterNormalizedText(_ value: String, maximum: Int) -> Bool {
    let collapsed = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return !value.isEmpty && value == collapsed
        && isSafeChapterDraftTitle(value, maximum: maximum)
}

private func isAbsoluteChapterPath(_ value: String) -> Bool {
    value.hasPrefix("/")
        && !value.contains("\0")
        && URL(fileURLWithPath: value).standardizedFileURL.path == value
}

private func isChapterDescendant(_ value: String, of root: String) -> Bool {
    isAbsoluteChapterPath(root) && root != "/"
        && isAbsoluteChapterPath(value) && value.hasPrefix(root + "/")
}

public struct ChapterContextPolicy: Codable, Equatable, Sendable {
    public let targetWindowDurationMs: Int
    public let maximumWindowDurationMs: Int
    public let maximumWindowCues: Int
    public let maximumWindowCharacters: Int
    public let minimumChapterDurationMs: Int
    public let maximumChapters: Int
    public let maximumTitleCharacters: Int

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "targetWindowDurationMs", "maximumWindowDurationMs", "maximumWindowCues",
            "maximumWindowCharacters", "minimumChapterDurationMs", "maximumChapters",
            "maximumTitleCharacters",
        ], label: "chapter context policy")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        targetWindowDurationMs = try container.decode(Int.self, forKey: .targetWindowDurationMs)
        maximumWindowDurationMs = try container.decode(Int.self, forKey: .maximumWindowDurationMs)
        maximumWindowCues = try container.decode(Int.self, forKey: .maximumWindowCues)
        maximumWindowCharacters = try container.decode(Int.self, forKey: .maximumWindowCharacters)
        minimumChapterDurationMs = try container.decode(Int.self, forKey: .minimumChapterDurationMs)
        maximumChapters = try container.decode(Int.self, forKey: .maximumChapters)
        maximumTitleCharacters = try container.decode(Int.self, forKey: .maximumTitleCharacters)
    }
}

public struct ChapterContextRecord: Codable, Equatable, Identifiable, Sendable {
    public var id: String { anchorId }

    public let anchorId: String
    public let sourceCueId: String
    public let sourceWordId: String
    public let startsAtMs: Int
    public let spokenStartsAtMs: Int
    public let endsAtMs: Int
    public let speakerId: String
    public let text: String

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "anchorId", "sourceCueId", "sourceWordId", "startsAtMs", "spokenStartsAtMs",
            "endsAtMs", "speakerId", "text",
        ], label: "chapter context record")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        anchorId = try container.decode(String.self, forKey: .anchorId)
        sourceCueId = try container.decode(String.self, forKey: .sourceCueId)
        sourceWordId = try container.decode(String.self, forKey: .sourceWordId)
        startsAtMs = try container.decode(Int.self, forKey: .startsAtMs)
        spokenStartsAtMs = try container.decode(Int.self, forKey: .spokenStartsAtMs)
        endsAtMs = try container.decode(Int.self, forKey: .endsAtMs)
        speakerId = try container.decode(String.self, forKey: .speakerId)
        text = try container.decode(String.self, forKey: .text)
    }
}

public struct ChapterContextWindow: Codable, Equatable, Identifiable, Sendable {
    public var id: String { windowId }

    public let windowId: String
    public let startsAtMs: Int
    public let endsAtMs: Int
    public let eligibleAnchorIds: [String]
    public let records: [ChapterContextRecord]

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "windowId", "startsAtMs", "endsAtMs", "eligibleAnchorIds", "records",
        ], label: "chapter context window")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        windowId = try container.decode(String.self, forKey: .windowId)
        startsAtMs = try container.decode(Int.self, forKey: .startsAtMs)
        endsAtMs = try container.decode(Int.self, forKey: .endsAtMs)
        eligibleAnchorIds = try container.decode([String].self, forKey: .eligibleAnchorIds)
        records = try container.decode([ChapterContextRecord].self, forKey: .records)
    }
}

public struct ChapterContext: Codable, Equatable, Sendable {
    public static let schema = "timed-text-chapter-context-v1"
    public static let policyVersion = "chapter-context-v1"

    public let schemaVersion: String
    public let policyVersion: String
    public let mode: ChapterMode
    public let durationMs: Int
    public let policy: ChapterContextPolicy
    public let windows: [ChapterContextWindow]

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "schemaVersion", "policyVersion", "mode", "durationMs", "policy", "windows",
        ], label: "chapter context")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        policyVersion = try container.decode(String.self, forKey: .policyVersion)
        mode = try container.decode(ChapterMode.self, forKey: .mode)
        durationMs = try container.decode(Int.self, forKey: .durationMs)
        policy = try container.decode(ChapterContextPolicy.self, forKey: .policy)
        windows = try container.decode([ChapterContextWindow].self, forKey: .windows)
        guard schemaVersion == Self.schema, policyVersion == Self.policyVersion,
              (30_000...86_400_000).contains(durationMs),
              (1...10_000).contains(windows.count),
              (30_000...1_800_000).contains(policy.targetWindowDurationMs),
              (30_000...1_800_000).contains(policy.maximumWindowDurationMs),
              (2...500).contains(policy.maximumWindowCues),
              (500...50_000).contains(policy.maximumWindowCharacters),
              (10_000...1_800_000).contains(policy.minimumChapterDurationMs),
              (3...200).contains(policy.maximumChapters),
              (10...200).contains(policy.maximumTitleCharacters),
              policy.targetWindowDurationMs <= policy.maximumWindowDurationMs
        else { throw ContractDecodingError.invalidValue("chapter context") }
        var anchors = Set<String>()
        var windowIDs = Set<String>()
        var previousEnd = 0
        var recordCount = 0
        for window in windows {
            guard window.windowId.range(
                of: #"^chapter_window_[0-9]{4}$"#, options: .regularExpression
            ) != nil,
                  windowIDs.insert(window.windowId).inserted,
                  (1...policy.maximumWindowCues).contains(window.records.count),
                  window.eligibleAnchorIds == window.records.map(\.anchorId),
                  window.startsAtMs == window.records.first?.startsAtMs,
                  window.endsAtMs == window.records.last?.endsAtMs,
                  window.endsAtMs - window.startsAtMs <= policy.maximumWindowDurationMs,
                  window.records.reduce(0, { $0 + $1.text.count }) <= policy.maximumWindowCharacters
            else { throw ContractDecodingError.invalidValue("chapter context window") }
            for record in window.records {
                recordCount += 1
                let isFirstRecord = anchors.isEmpty
                guard recordCount <= 10_000, isChapterAnchorID(record.anchorId),
                      anchors.insert(record.anchorId).inserted,
                      isChapterAnchorID(record.sourceCueId), isChapterAnchorID(record.sourceWordId),
                      record.startsAtMs == (isFirstRecord ? 0 : record.spokenStartsAtMs),
                      record.spokenStartsAtMs >= previousEnd,
                      record.endsAtMs > record.spokenStartsAtMs, record.endsAtMs <= durationMs,
                      isSafeChapterNormalizedText(record.speakerId, maximum: 120),
                      isSafeChapterNormalizedText(record.text, maximum: 2_000)
                else { throw ContractDecodingError.invalidValue("chapter context record") }
                previousEnd = record.endsAtMs
            }
        }
        guard windows.first?.records.first?.startsAtMs == 0 else {
            throw ContractDecodingError.invalidValue("chapter context first anchor")
        }
    }
}

public struct ChapterContextArtifact: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-chapter-context-v1"

    public let schemaVersion: String
    public let contextId: String
    public let projectId: String
    public let sourceAudioSha256: String
    public let transcriptId: String
    public let transcriptManifestSha256: String
    public let alignmentRevisionId: String
    public let alignmentManifestSha256: String
    public let mode: ChapterMode
    public let context: ChapterContext
    public let manifestSha256: String

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "schemaVersion", "contextId", "projectId", "sourceAudioSha256", "transcriptId",
            "transcriptManifestSha256", "alignmentRevisionId", "alignmentManifestSha256",
            "mode", "context", "manifestSha256",
        ], label: "chapter context artifact")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        contextId = try container.decode(String.self, forKey: .contextId)
        projectId = try container.decode(String.self, forKey: .projectId)
        sourceAudioSha256 = try container.decode(String.self, forKey: .sourceAudioSha256)
        transcriptId = try container.decode(String.self, forKey: .transcriptId)
        transcriptManifestSha256 = try container.decode(String.self, forKey: .transcriptManifestSha256)
        alignmentRevisionId = try container.decode(String.self, forKey: .alignmentRevisionId)
        alignmentManifestSha256 = try container.decode(String.self, forKey: .alignmentManifestSha256)
        mode = try container.decode(ChapterMode.self, forKey: .mode)
        context = try container.decode(ChapterContext.self, forKey: .context)
        manifestSha256 = try container.decode(String.self, forKey: .manifestSha256)
        guard schemaVersion == Self.schema, isChapterContextID(contextId),
              projectId.range(
                of: #"^project_[a-f0-9]{16}_[0-9]{14}$"#, options: .regularExpression
              ) != nil,
              transcriptId.range(
                of: #"^transcript_[a-f0-9]{24}$"#, options: .regularExpression
              ) != nil,
              alignmentRevisionId.range(
                of: #"^alignment_[a-f0-9]{24}$"#, options: .regularExpression
              ) != nil,
              [sourceAudioSha256, transcriptManifestSha256,
               alignmentManifestSha256, manifestSha256].allSatisfy(isChapterSHA256),
              mode == context.mode
        else { throw ContractDecodingError.invalidValue("chapter context artifact") }
    }
}

public struct ChapterEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: String { anchorId }

    public let anchorId: String
    public var title: String

    public init(anchorId: String, title: String) {
        self.anchorId = anchorId
        self.title = title
    }

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(
            decoder,
            allowed: ["anchorId", "title"],
            label: "chapter entry"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        anchorId = try container.decode(String.self, forKey: .anchorId)
        title = try container.decode(String.self, forKey: .title)
    }
}

public struct ChapterEditPayload: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-chapter-edit-v1"

    public let schemaVersion: String
    public let contextId: String
    public let contextManifestSha256: String
    public let entries: [ChapterEntry]

    public init(context: ChapterContextArtifact, entries: [ChapterEntry]) {
        schemaVersion = Self.schema
        contextId = context.contextId
        contextManifestSha256 = context.manifestSha256
        self.entries = entries
    }

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "schemaVersion", "contextId", "contextManifestSha256", "entries",
        ], label: "chapter edit")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        contextId = try container.decode(String.self, forKey: .contextId)
        contextManifestSha256 = try container.decode(String.self, forKey: .contextManifestSha256)
        entries = try container.decode([ChapterEntry].self, forKey: .entries)
    }
}

public struct CompiledChapter: Codable, Equatable, Identifiable, Sendable {
    public var id: String { anchorId }

    public let anchorId: String
    public let sourceCueId: String
    public let sourceWordId: String
    public let startsAtMs: Int
    public let title: String

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "anchorId", "sourceCueId", "sourceWordId", "startsAtMs", "title",
        ], label: "compiled chapter")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        anchorId = try container.decode(String.self, forKey: .anchorId)
        sourceCueId = try container.decode(String.self, forKey: .sourceCueId)
        sourceWordId = try container.decode(String.self, forKey: .sourceWordId)
        startsAtMs = try container.decode(Int.self, forKey: .startsAtMs)
        title = try container.decode(String.self, forKey: .title)
    }
}

public struct ChapterList: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let mode: ChapterMode
    public let durationMs: Int
    public let policyVersion: String
    public let chapters: [CompiledChapter]

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "schemaVersion", "mode", "durationMs", "policyVersion", "chapters",
        ], label: "chapter list")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        mode = try container.decode(ChapterMode.self, forKey: .mode)
        durationMs = try container.decode(Int.self, forKey: .durationMs)
        policyVersion = try container.decode(String.self, forKey: .policyVersion)
        chapters = try container.decode([CompiledChapter].self, forKey: .chapters)
        guard schemaVersion == "timed-text-chapter-list-v1",
              policyVersion == ChapterContext.policyVersion,
              (30_000...86_400_000).contains(durationMs),
              (3...200).contains(chapters.count)
        else { throw ContractDecodingError.invalidValue("chapter list") }
        var anchors = Set<String>()
        var previousStart: Int?
        for (index, chapter) in chapters.enumerated() {
            guard isChapterAnchorID(chapter.anchorId), anchors.insert(chapter.anchorId).inserted,
                  isChapterAnchorID(chapter.sourceCueId), isChapterAnchorID(chapter.sourceWordId),
                  chapter.startsAtMs >= 0, chapter.startsAtMs < durationMs,
                  isSafeChapterNormalizedText(chapter.title, maximum: 100),
                  (index != 0 || chapter.startsAtMs == 0),
                  previousStart.map({ chapter.startsAtMs - $0 >= 10_000 }) ?? true
            else { throw ContractDecodingError.invalidValue("chapter list entry") }
            previousStart = chapter.startsAtMs
        }
        guard durationMs - (chapters.last?.startsAtMs ?? durationMs) >= 10_000 else {
            throw ContractDecodingError.invalidValue("chapter list final entry")
        }
    }
}

public struct ApprovedChapters: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let chapterRevisionId: String
    public let contextId: String
    public let contextManifestSha256: String
    public let list: ChapterList
    public let manifestSha256: String

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "schemaVersion", "chapterRevisionId", "contextId", "contextManifestSha256",
            "list", "manifestSha256",
        ], label: "approved chapters")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        chapterRevisionId = try container.decode(String.self, forKey: .chapterRevisionId)
        contextId = try container.decode(String.self, forKey: .contextId)
        contextManifestSha256 = try container.decode(String.self, forKey: .contextManifestSha256)
        list = try container.decode(ChapterList.self, forKey: .list)
        manifestSha256 = try container.decode(String.self, forKey: .manifestSha256)
        guard schemaVersion == "podcast-visualizer-approved-chapters-v1",
              isChapterRevisionID(chapterRevisionId), isChapterContextID(contextId),
              isChapterSHA256(contextManifestSha256), isChapterSHA256(manifestSha256)
        else { throw ContractDecodingError.invalidValue("approved chapters") }
    }
}

public struct ChapterWorkspace: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-chapter-workspace-v1"

    public let schemaVersion: String
    public let projectRoot: String
    public let contextPath: String
    public let workingPath: String
    public let contextArtifact: ChapterContextArtifact
    public let edit: ChapterEditPayload
    public let approved: ApprovedChapters?

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "schemaVersion", "projectRoot", "contextPath", "workingPath", "contextArtifact",
            "edit", "approved",
        ], label: "chapter workspace")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        projectRoot = try container.decode(String.self, forKey: .projectRoot)
        contextPath = try container.decode(String.self, forKey: .contextPath)
        workingPath = try container.decode(String.self, forKey: .workingPath)
        contextArtifact = try container.decode(ChapterContextArtifact.self, forKey: .contextArtifact)
        edit = try container.decode(ChapterEditPayload.self, forKey: .edit)
        approved = try container.decodeIfPresent(ApprovedChapters.self, forKey: .approved)
        let records = contextArtifact.context.windows.flatMap(\.records)
        let recordsByID = Dictionary(uniqueKeysWithValues: records.map { ($0.anchorId, $0) })
        guard container.contains(.approved), schemaVersion == Self.schema,
              isAbsoluteChapterPath(projectRoot),
              isChapterDescendant(contextPath, of: projectRoot),
              isChapterDescendant(workingPath, of: projectRoot),
              edit.schemaVersion == ChapterEditPayload.schema,
              edit.contextId == contextArtifact.contextId,
              edit.contextManifestSha256 == contextArtifact.manifestSha256,
              edit.entries.count <= contextArtifact.context.policy.maximumChapters,
              Set(edit.entries.map(\.anchorId)).count == edit.entries.count,
              edit.entries.allSatisfy({
                  isChapterAnchorID($0.anchorId)
                      && recordsByID[$0.anchorId] != nil
                      && isSafeChapterDraftTitle(
                        $0.title,
                        maximum: contextArtifact.context.policy.maximumTitleCharacters
                      )
              }),
              approved.map({
                  $0.schemaVersion == "podcast-visualizer-approved-chapters-v1"
                      && isChapterRevisionID($0.chapterRevisionId)
                      && $0.contextId == contextArtifact.contextId
                      && $0.contextManifestSha256 == contextArtifact.manifestSha256
                      && isChapterSHA256($0.manifestSha256)
                      && $0.list.mode == contextArtifact.context.mode
                      && $0.list.durationMs == contextArtifact.context.durationMs
                      && $0.list.policyVersion == contextArtifact.context.policyVersion
                      && $0.list.chapters.allSatisfy({ chapter in
                          recordsByID[chapter.anchorId].map({ record in
                              record.sourceCueId == chapter.sourceCueId
                                  && record.sourceWordId == chapter.sourceWordId
                                  && record.startsAtMs == chapter.startsAtMs
                          }) ?? false
                      })
              }) ?? true
        else { throw ContractDecodingError.invalidValue("chapter workspace") }
    }
}

public struct ChapterSaveResult: Codable, Equatable, Sendable {
    public let contextId: String
    public let workingPath: String
    public let entries: Int

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "contextId", "workingPath", "entries",
        ], label: "chapter save result")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try container.decode(String.self, forKey: .contextId)
        workingPath = try container.decode(String.self, forKey: .workingPath)
        entries = try container.decode(Int.self, forKey: .entries)
        guard isChapterContextID(contextId), workingPath.hasPrefix("/"),
              (0...200).contains(entries)
        else { throw ContractDecodingError.invalidValue("chapter save result") }
    }
}

public struct ChapterApprovalResult: Codable, Equatable, Sendable {
    public let state: String
    public let chapterRevisionId: String
    public let manifestSha256: String
    public let revisionPath: String
    public let chapters: Int

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "state", "chapterRevisionId", "manifestSha256", "revisionPath", "chapters",
        ], label: "chapter approval result")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(String.self, forKey: .state)
        chapterRevisionId = try container.decode(String.self, forKey: .chapterRevisionId)
        manifestSha256 = try container.decode(String.self, forKey: .manifestSha256)
        revisionPath = try container.decode(String.self, forKey: .revisionPath)
        chapters = try container.decode(Int.self, forKey: .chapters)
        guard state == "approved", isChapterRevisionID(chapterRevisionId),
              isChapterSHA256(manifestSha256), revisionPath.hasPrefix("/"),
              (3...200).contains(chapters)
        else { throw ContractDecodingError.invalidValue("chapter approval result") }
    }
}

public struct ChapterExportResult: Codable, Equatable, Sendable {
    public let format: String
    public let outputPath: String
    public let content: String
    public let chapterRevisionId: String
    public let manifestSha256: String

    public init(from decoder: Decoder) throws {
        try rejectUnexpectedChapterFields(decoder, allowed: [
            "format", "outputPath", "content", "chapterRevisionId", "manifestSha256",
        ], label: "chapter export result")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        format = try container.decode(String.self, forKey: .format)
        outputPath = try container.decode(String.self, forKey: .outputPath)
        content = try container.decode(String.self, forKey: .content)
        chapterRevisionId = try container.decode(String.self, forKey: .chapterRevisionId)
        manifestSha256 = try container.decode(String.self, forKey: .manifestSha256)
        guard ["youtube", "markdown", "json"].contains(format), outputPath.hasPrefix("/"),
              !content.isEmpty, content.utf8.count <= 2 * 1024 * 1024,
              isChapterRevisionID(chapterRevisionId), isChapterSHA256(manifestSha256)
        else { throw ContractDecodingError.invalidValue("chapter export result") }
    }
}

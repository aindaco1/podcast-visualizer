import Foundation
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@MainActor
@Suite("On-device chapter advice")
struct ChapterAdviserTests {
    @Test("accepts only supplied grounded anchors and enforces timestamp spacing")
    func sanitizesModelProposals() throws {
        let workspace = try chapterWorkspace()
        let records = workspace.contextArtifact.context.windows[0].records
        let proposals = [
            ProposedChapter(
                anchorId: records[0].anchorId,
                title: " Opening ",
                evidenceQuote: "welcome to the show"
            ),
            ProposedChapter(
                anchorId: records[1].anchorId,
                title: "Production workflow",
                evidenceQuote: "production topic"
            ),
            ProposedChapter(
                anchorId: records[2].anchorId,
                title: "Release checklist",
                evidenceQuote: "release checklist"
            ),
            ProposedChapter(
                anchorId: records[2].anchorId,
                title: "Duplicate",
                evidenceQuote: "release checklist"
            ),
            ProposedChapter(
                anchorId: "chapter_anchor_invented",
                title: "Invented",
                evidenceQuote: "welcome"
            ),
            ProposedChapter(
                anchorId: records[1].anchorId,
                title: "Ungrounded",
                evidenceQuote: "not in the record"
            ),
        ]
        let entries = ChapterAdvicePolicy.entries(
            from: proposals,
            context: workspace.contextArtifact
        )
        #expect(entries.map(\.anchorId) == records.map(\.anchorId))
        #expect(entries.map(\.title) == ["Opening", "Production workflow", "Release checklist"])
    }

    @Test("detects clips without enough grounded chapter starts before generation")
    func detectsInsufficientChapterStarts() {
        let count = ChapterAdvicePolicy.eligibleStartCount(
            [0, 4_201, 8_400, 30_382],
            durationMs: 33_157,
            minimumDurationMs: 10_000,
            maximumCount: 200
        )

        #expect(count == 1)
        #expect(ChapterAdvicePolicy.eligibleStartCount(
            [0, 10_000, 20_000],
            durationMs: 30_000,
            minimumDurationMs: 10_000,
            maximumCount: 200
        ) == ChapterAdvicePolicy.minimumChapterCount)
    }

    @Test("insufficient starts explain recovery and preserved drafts")
    func insufficientStartPresentation() throws {
        let store = ChapterReviewStore()
        store.load(try chapterWorkspace())

        store.markGenerationUnavailable(eligibleAnchorCount: 1)

        #expect(store.statusMessage.contains("1 eligible chapter start"))
        #expect(store.statusMessage.contains("at least 3"))
        #expect(store.statusMessage.contains("longer clip"))
        #expect(store.statusMessage.contains("drafts were preserved"))
    }

    @Test("retries incomplete structured output once in smaller batches")
    func retriesIncompleteOutput() async throws {
        let workspace = try chapterWorkspace()
        let generator = IncompleteFirstChapterGenerator()
        let progress = ChapterProgressRecorder()

        let advice = try await OnDeviceChapterAdviser(generator: generator).advise(
            context: workspace.contextArtifact
        ) { event in
            await progress.append(event)
        }

        #expect(await generator.batchSizes() == [3, 1, 2])
        #expect(advice.entries.count == 3)
        #expect(await progress.events().map(\.phase) == [
            .generating, .retryingSmallerBatch, .generating,
        ])
    }

    @Test("bounds an incomplete-response retry to one split attempt")
    func boundsIncompleteOutputRetry() async throws {
        let workspace = try chapterWorkspace()
        let generator = AlwaysIncompleteChapterGenerator()

        await #expect(throws: ChapterGenerationError.incompleteResponse) {
            try await OnDeviceChapterAdviser(generator: generator).advise(
                context: workspace.contextArtifact
            )
        }
        #expect(await generator.batchSizes() == [3, 1])
    }

    @Test("keeps partial results when one bounded window is unavailable")
    func skipsUnavailableWindow() async throws {
        let workspace = try chapterWorkspace()
        let progress = ChapterProgressRecorder()
        let generator = ContentRestrictedChapterGenerator()

        let advice = try await OnDeviceChapterAdviser(
            generator: generator
        ).advise(context: workspace.contextArtifact) { event in
            await progress.append(event)
        }

        #expect(advice.entries.isEmpty)
        #expect(advice.skippedWindows == 1)
        #expect(await generator.batchSizes() == [3, 1, 2])
        #expect(await progress.events().map(\.phase) == [
            .generating, .retryingSmallerBatch, .skippingUnavailableWindow, .generating,
        ])
    }

    @Test("reports style-specific bounded progress")
    func progressPresentation() {
        let progress = ChapterAdviceProgress(
            phase: .generating,
            completedWindows: 2,
            currentWindow: 3,
            totalWindows: 7
        )

        #expect(progress.label(for: .topics) == "Generating topic chapter suggestions")
        #expect(progress.label(for: .questions) == "Generating question chapter suggestions")
        #expect(progress.detail == "window 3 of 7")
        #expect(progress.fraction == 2.0 / 7.0)
        let retry = ChapterAdviceProgress(
            phase: .retryingSmallerBatch,
            completedWindows: 2,
            currentWindow: 3,
            totalWindows: 7
        )
        #expect(retry.label(for: .topics) == "Retrying a smaller topic batch")
        let skipped = ChapterAdviceProgress(
            phase: .skippingUnavailableWindow,
            completedWindows: 2,
            currentWindow: 3,
            totalWindows: 7
        )
        #expect(skipped.label(for: .questions) == "Skipping an unavailable question window")
    }

    @Test("incomplete model failures explain recovery and preserve drafts")
    func incompleteFailurePresentation() throws {
        let store = ChapterReviewStore()
        store.load(try chapterWorkspace())

        store.markGenerationFailed(ChapterGenerationError.incompleteResponse)

        #expect(store.statusMessage.contains("incomplete response"))
        #expect(store.statusMessage.contains("try Generate On Device again"))
        #expect(store.statusMessage.contains("existing chapter draft was preserved"))
        #expect(!store.statusMessage.contains("/Users/"))
    }

    @Test("all model failures remain actionable and privacy safe")
    func allFailurePresentations() {
        let failures: [Error] = [
            ChapterGenerationError.modelUnavailable,
            ChapterGenerationError.incompleteResponse,
            ChapterGenerationError.contextTooLarge,
            ChapterGenerationError.contentRestricted,
            ChapterGenerationError.unsupportedLanguage,
            ChapterGenerationError.unsupportedConfiguration,
            ChapterGenerationError.temporarilyUnavailable,
            NSError(domain: "/Users/example/private-transcript", code: 7),
        ]

        for failure in failures {
            let message = ChapterReviewStore.generationFailureMessage(for: failure)
            let normalized = message.lowercased()
            #expect(message.contains("existing chapter draft was preserved"))
            #expect(
                normalized.contains("try") || normalized.contains("confirm")
                    || normalized.contains("reload") || normalized.contains("add chapters manually")
            )
            #expect(!message.contains("/Users/"))
        }
    }

    @Test("chapter store keeps suggestions editable and approval gated")
    func reviewStore() throws {
        let workspace = try chapterWorkspace()
        let records = workspace.contextArtifact.context.windows[0].records
        let store = ChapterReviewStore()
        store.load(workspace)
        #expect(!store.isDirty)
        #expect(!store.canApprove)
        store.applyAdvice(.unavailable)
        #expect(store.statusMessage.contains("existing chapter draft was preserved"))
        store.applyAdvice(ChapterAdvice(entries: [
            ChapterEntry(anchorId: records[0].anchorId, title: "Opening"),
            ChapterEntry(anchorId: records[1].anchorId, title: "Main topic"),
            ChapterEntry(anchorId: records[2].anchorId, title: "Closing"),
        ], usedOnDeviceModel: true, skippedWindows: 1))
        #expect(store.isDirty)
        #expect(store.canApprove)
        #expect(store.statusMessage.contains("skipped 1 bounded transcript window"))
        #expect(store.statusMessage.contains("add any missing chapters manually"))
        #expect(store.timestamp(for: records[1].anchorId) == "01:00")
        let approval = try chapterApproval()
        store.markApproved(approval)
        #expect(store.hasApproval)
        store.updateTitle(anchorId: records[1].anchorId, title: "")
        #expect(!store.hasApproval)
        #expect(!store.canApprove)
        store.remove(anchorId: records[2].anchorId)
        #expect(store.editPayload()?.entries.count == 2)
    }

    private func chapterWorkspace() throws -> ChapterWorkspace {
        try chapterFixture("chapters load", as: ChapterWorkspace.self)
    }

    private func chapterApproval() throws -> ChapterApprovalResult {
        try chapterFixture("chapters approve", as: ChapterApprovalResult.self)
    }

    private func chapterFixture<T: Decodable>(_ command: String, as type: T.Type) throws -> T {
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let data = try Data(contentsOf: repository.appendingPathComponent(
            "test/fixtures/cli-contract/v1/success.json"
        ))
        let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let fixtures = root["fixtures"] as! [[String: Any]]
        let output = fixtures.first { $0["command"] as? String == command }!["output"]!
        return try ContractDecoder.decode(
            type,
            from: JSONSerialization.data(withJSONObject: output)
        )
    }
}

private actor ChapterProgressRecorder {
    private var values: [ChapterAdviceProgress] = []

    func append(_ progress: ChapterAdviceProgress) {
        values.append(progress)
    }

    func events() -> [ChapterAdviceProgress] {
        values
    }
}

private actor IncompleteFirstChapterGenerator: ChapterWindowGenerating {
    private var sizes: [Int] = []

    func proposals(
        records: [ChapterContextRecord],
        mode: ChapterMode,
        requireOpening: Bool
    ) async throws -> [ProposedChapter] {
        sizes.append(records.count)
        if sizes.count == 1 {
            throw ChapterGenerationError.incompleteResponse
        }
        return groundedProposals(for: records)
    }

    func batchSizes() -> [Int] {
        sizes
    }
}

private actor AlwaysIncompleteChapterGenerator: ChapterWindowGenerating {
    private var sizes: [Int] = []

    func proposals(
        records: [ChapterContextRecord],
        mode: ChapterMode,
        requireOpening: Bool
    ) async throws -> [ProposedChapter] {
        sizes.append(records.count)
        throw ChapterGenerationError.incompleteResponse
    }

    func batchSizes() -> [Int] {
        sizes
    }
}

private actor ContentRestrictedChapterGenerator: ChapterWindowGenerating {
    private var sizes: [Int] = []

    func proposals(
        records: [ChapterContextRecord],
        mode: ChapterMode,
        requireOpening: Bool
    ) async throws -> [ProposedChapter] {
        sizes.append(records.count)
        throw ChapterGenerationError.contentRestricted
    }

    func batchSizes() -> [Int] {
        sizes
    }
}

private func groundedProposals(for records: [ChapterContextRecord]) -> [ProposedChapter] {
    records.map { record in
        ProposedChapter(
            anchorId: record.anchorId,
            title: "Chapter \(record.startsAtMs)",
            evidenceQuote: record.text
        )
    }
}

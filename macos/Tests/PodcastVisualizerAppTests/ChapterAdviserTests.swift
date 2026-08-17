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

    @Test("chapter store keeps suggestions editable and approval gated")
    func reviewStore() throws {
        let workspace = try chapterWorkspace()
        let records = workspace.contextArtifact.context.windows[0].records
        let store = ChapterReviewStore()
        store.load(workspace)
        #expect(!store.isDirty)
        #expect(!store.canApprove)
        store.applyAdvice(ChapterAdvice(entries: [
            ChapterEntry(anchorId: records[0].anchorId, title: "Opening"),
            ChapterEntry(anchorId: records[1].anchorId, title: "Main topic"),
            ChapterEntry(anchorId: records[2].anchorId, title: "Closing"),
        ], usedOnDeviceModel: true))
        #expect(store.isDirty)
        #expect(store.canApprove)
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

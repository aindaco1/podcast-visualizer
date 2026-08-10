import Foundation
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@Suite("On-device dialogue boundary advice")
struct DialogueBoundaryAdviserTests {
    private func cue(
        _ index: Int,
        speaker: String = "speaker-01",
        confirmed: Bool = true,
        startsAtMs: Int? = nil,
        endsAtMs: Int? = nil,
        text: String? = nil
    ) -> ReviewCue {
        ReviewCue(
            id: String(format: "cue_%06d", index),
            startsAtMs: startsAtMs ?? (index - 1) * 1_000,
            endsAtMs: endsAtMs ?? ((index - 1) * 1_000 + 700),
            textMarkdown: text ?? "Dialogue cue \(index).",
            speakerLabel: speaker,
            speakerConfirmed: confirmed,
            speakerConfidence: 1,
            speakerAmbiguous: false
        )
    }

    @Test("offers only bounded confirmed same-speaker boundaries")
    func boundedCandidates() {
        let cues = [
            cue(1, text: String(repeating: "a", count: 500)),
            cue(2),
            cue(3, speaker: "speaker-02"),
            cue(4, speaker: "speaker-02", confirmed: false),
            cue(5, speaker: "speaker-02", startsAtMs: 5_000, endsAtMs: 5_700),
        ]
        let candidates = DialogueBoundaryAdvicePolicy.candidates(from: cues)

        #expect(candidates.map(\.afterCueId) == ["cue_000001"])
        #expect(candidates[0].leftText.count == 320)
        #expect(candidates[0].gapMs == 300)
    }

    @Test("samples a long transcript across its full duration")
    func samplesLongTranscript() {
        let candidates = DialogueBoundaryAdvicePolicy.candidates(
            from: (1...500).map { cue($0) }
        )

        #expect(candidates.count == DialogueBoundaryAdvicePolicy.maximumCandidates)
        #expect(candidates.first?.afterCueId == "cue_000001")
        #expect(candidates.last?.afterCueId == "cue_000499")
    }

    @Test("accepts only unique supplied IDs and known actions")
    func sanitizesModelOutput() {
        let candidates = DialogueBoundaryAdvicePolicy.candidates(from: [cue(1), cue(2), cue(3)])
        let hints = DialogueBoundaryAdvicePolicy.hints(from: [
            ProposedDialogueBoundary(afterCueId: "cue_000002", action: "keep"),
            ProposedDialogueBoundary(afterCueId: "cue_000001", action: "merge"),
            ProposedDialogueBoundary(afterCueId: "cue_000001", action: "keep"),
            ProposedDialogueBoundary(afterCueId: "cue_999999", action: "merge"),
            ProposedDialogueBoundary(afterCueId: "cue_000002", action: "rewrite"),
        ], candidates: candidates)

        #expect(hints == [
            ReviewReflowBoundaryHint(afterCueId: "cue_000001", action: .merge),
            ReviewReflowBoundaryHint(afterCueId: "cue_000002", action: .keep),
        ])
    }

    @Test("does not consult the system model when there are no candidate boundaries")
    func emptyFallback() async throws {
        let advice = try await OnDeviceDialogueBoundaryAdviser().advise(cues: [cue(1)])
        #expect(advice == .deterministic)
    }

    @Test("model failures fall back without blocking approval")
    @MainActor
    func failureFallback() async throws {
        let store = AppStore(
            client: RecordingApprovalCLI(),
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false")),
            updateChecker: NoopDialogueUpdateChecker(),
            brand: nil,
            dialogueBoundaryAdviser: FailingDialogueAdviser()
        )

        let advice = try await store.transcriptBoundaryAdvice(for: [cue(1), cue(2)])

        #expect(advice == .deterministic)
        #expect(!store.isAdvisingTranscript)
        #expect(!store.isRunning)
    }

    @Test("approval sends only sanitized adviser hints through the version-four contract")
    @MainActor
    func approvalIntegration() async throws {
        let adviser = RecordingDialogueAdviser()
        let client = RecordingApprovalCLI()
        let store = AppStore(
            client: client,
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false")),
            updateChecker: NoopDialogueUpdateChecker(),
            brand: nil,
            dialogueBoundaryAdviser: adviser
        )
        let digest = String(repeating: "a", count: 64)
        let status = try ContractDecoder.decode(
            StatusResult.self,
            from: try JSONSerialization.data(withJSONObject: [
                "projectRoot": "/Users/example/Project",
                "projectId": "project_aaaaaaaaaaaaaaaa_20260808010101",
                "state": "review_required",
                "sourcePath": "/Users/example/episode.wav",
                "sourceSha256": digest,
                "clip": ["startsAtMs": 0, "endsAtMs": 2_000, "durationMs": 2_000],
            ])
        )
        try store.state.reduce(.projectOpened(status))
        store.transcriptReview.load(ReviewWorkspace(
            projectRoot: "/Users/example/Project",
            draftManifestSha256: digest,
            audioPath: "/Users/example/Project/source/review.wav",
            durationMs: 2_000,
            speakers: [ReviewSpeaker(id: "speaker-01", displayName: "Host")],
            cues: [cue(1), cue(2)],
            hasWorkingCopy: false
        ))

        store.approveTranscriptReview()
        for _ in 0..<200 {
            if await client.reviewEdit() != nil { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let data = try #require(await client.reviewEdit())
        let edit = try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(edit["schemaVersion"] as? String == ReviewEditPayload.schema)
        let hints = try #require(edit["reflowBoundaryHints"] as? [[String: String]])
        #expect(hints == [["afterCueId": "cue_000001", "action": "merge"]])
        #expect(await adviser.callCount() == 1)
    }
}

@MainActor
private final class NoopDialogueUpdateChecker: UpdateChecking {
    let canCheckForUpdates = true
    func checkForUpdates() {}
}

private actor RecordingDialogueAdviser: DialogueBoundaryAdvising {
    private var calls = 0

    func advise(cues: [ReviewCue]) async throws -> DialogueBoundaryAdvice {
        calls += 1
        return DialogueBoundaryAdvice(
            hints: [ReviewReflowBoundaryHint(afterCueId: cues[0].id, action: .merge)],
            usedOnDeviceModel: true
        )
    }

    func callCount() -> Int { calls }
}

private struct FailingDialogueAdviser: DialogueBoundaryAdvising {
    func advise(cues: [ReviewCue]) async throws -> DialogueBoundaryAdvice {
        throw WorkflowFailure(code: "fixture_failure", message: "fixture")
    }
}

private actor RecordingApprovalCLI: CLIExecuting {
    private var capturedReviewEdit: Data?

    func run(
        _ command: CLICommand,
        onProgress: @escaping @Sendable (CLIProgressEvent) async -> Void
    ) async throws -> CLIExecution {
        if command.arguments.starts(with: ["review", "approve"]),
           let inputIndex = command.arguments.firstIndex(of: "--input"),
           command.arguments.indices.contains(inputIndex + 1) {
            let data = try Data(contentsOf: URL(fileURLWithPath: command.arguments[inputIndex + 1]))
            capturedReviewEdit = data
            return try execution([
                "state": "approved",
                "transcriptId": "transcript_aaaaaaaaaaaaaaaaaaaaaaaa",
                "contentSha256": String(repeating: "b", count: 64),
                "manifestSha256": String(repeating: "c", count: 64),
            ])
        }
        if command.arguments.starts(with: ["models", "status"]) {
            return try execution([
                "ok": false,
                "checks": [
                    ["id": "parakeet-v3", "ok": true, "modelRoot": NSNull(), "detail": "ready"],
                    ["id": "align-en", "ok": false, "modelRoot": NSNull(), "detail": "missing"],
                ],
            ])
        }
        throw WorkflowFailure(code: "unexpected_test_command", message: command.label)
    }

    func cancelCurrentCommand() async {}

    func reviewEdit() -> Data? { capturedReviewEdit }

    private func execution(_ object: [String: Any]) throws -> CLIExecution {
        CLIExecution(
            exitCode: 0,
            standardOutput: try JSONSerialization.data(withJSONObject: object),
            standardError: Data()
        )
    }
}

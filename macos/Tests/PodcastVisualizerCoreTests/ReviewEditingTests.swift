import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Transcript review editing")
struct ReviewEditingTests {
    private var cues: [ReviewCue] {
        [
            ReviewCue(
                id: "cue_000001", startsAtMs: 0, endsAtMs: 1000,
                textMarkdown: "Lucid link is not lucid linked.", speakerLabel: "speaker-01",
                speakerConfirmed: false, speakerConfidence: 0.8, speakerAmbiguous: true
            ),
            ReviewCue(
                id: "cue_000002", startsAtMs: 1200, endsAtMs: 2200,
                textMarkdown: "A Lucid link costs $5.", speakerLabel: "speaker-03",
                speakerConfirmed: false, speakerConfidence: 0.9, speakerAmbiguous: false
            ),
        ]
    }

    @Test("merges one anonymous speaker globally without changing timing or text")
    func mergeSpeaker() {
        let merged = ReviewEditing.mergeSpeaker("speaker-03", into: "speaker-01", in: cues)
        #expect(merged.map(\.speakerLabel) == ["speaker-01", "speaker-01"])
        #expect(merged[1].speakerConfirmed)
        #expect(merged[1].textMarkdown == cues[1].textMarkdown)
        #expect(merged[1].startsAtMs == cues[1].startsAtMs)
    }

    @Test("merges a cue with the next chronological cue using browser-compatible speaker rules")
    func mergeNextCue() {
        let merged = ReviewEditing.mergeNext(at: 0, in: cues)
        #expect(merged.count == 1)
        #expect(merged[0].id == "cue_000001")
        #expect(merged[0].startsAtMs == 0)
        #expect(merged[0].endsAtMs == 2200)
        #expect(merged[0].textMarkdown == "Lucid link is not lucid linked. A Lucid link costs $5.")
        #expect(merged[0].speakerLabel == "speaker-01")
        #expect(!merged[0].speakerConfirmed)
        #expect(merged[0].speakerAmbiguous)

        var sameSpeaker = cues
        sameSpeaker[0].speakerConfirmed = true
        sameSpeaker[1].speakerLabel = "speaker-01"
        sameSpeaker[1].speakerConfirmed = true
        let confirmed = ReviewEditing.mergeNext(at: 0, in: sameSpeaker)
        #expect(confirmed[0].speakerConfirmed)
        #expect(!confirmed[0].speakerAmbiguous)
        #expect(ReviewEditing.mergeNext(at: 1, in: cues) == cues)
    }

    @Test("replaces literal text within cues and treats dollar signs literally")
    func replaceLiteralText() {
        let branded = ReviewEditing.replaceAll(
            "Lucid link", with: "LucidLink", in: cues, caseSensitive: true, wholeWords: false
        )
        #expect(branded.replacements == 2)
        #expect(branded.cues[0].textMarkdown == "LucidLink is not lucid linked.")
        let prices = ReviewEditing.replaceAll(
            "$5", with: "$10", in: branded.cues, caseSensitive: true, wholeWords: false
        )
        #expect(prices.replacements == 1)
        #expect(prices.cues[1].textMarkdown.hasSuffix("costs $10."))
    }

    @Test("supports case-insensitive whole-word replacement without crossing cue boundaries")
    func wholeWordReplacement() {
        let result = ReviewEditing.replaceAll(
            "lucid", with: "Clear", in: cues, caseSensitive: false, wholeWords: true
        )
        #expect(result.replacements == 3)
        #expect(result.cues[0].textMarkdown == "Clear link is not Clear linked.")
        let boundaryCues = [
            ReviewCue(
                id: "cue_000001", startsAtMs: 0, endsAtMs: 1000, textMarkdown: "Lucid",
                speakerLabel: "speaker-01", speakerConfirmed: true,
                speakerConfidence: 1, speakerAmbiguous: false
            ),
            ReviewCue(
                id: "cue_000002", startsAtMs: 1000, endsAtMs: 2000, textMarkdown: "Link",
                speakerLabel: "speaker-01", speakerConfirmed: true,
                speakerConfidence: 1, speakerAmbiguous: false
            ),
        ]
        #expect(ReviewEditing.replaceAll(
            "Lucid Link", with: "LucidLink", in: boundaryCues, caseSensitive: true, wholeWords: false
        ).replacements == 0)
    }

    @Test("decodes a bounded versioned native review workspace")
    func workspaceContract() throws {
        let value: [String: Any] = [
            "schemaVersion": ReviewWorkspace.schema,
            "projectRoot": "/Users/example/project",
            "draftManifestSha256": String(repeating: "a", count: 64),
            "audioPath": "/Users/example/project/source/review.wav",
            "durationMs": 2200,
            "speakers": ["speaker-01", "speaker-03"],
            "cues": cues.map { cue in
                [
                    "id": cue.id, "startsAtMs": cue.startsAtMs, "endsAtMs": cue.endsAtMs,
                    "textMarkdown": cue.textMarkdown, "speakerLabel": cue.speakerLabel,
                    "speakerConfirmed": cue.speakerConfirmed,
                    "speakerConfidence": cue.speakerConfidence,
                    "speakerAmbiguous": cue.speakerAmbiguous,
                ] as [String: Any]
            },
            "hasWorkingCopy": false,
        ]
        let data = try JSONSerialization.data(withJSONObject: value)
        let workspace = try ContractDecoder.decode(ReviewWorkspace.self, from: data)
        #expect(workspace.cues.count == 2)
        #expect(workspace.audioPath.hasSuffix("review.wav"))
        var nonCanonical = value
        nonCanonical["draftManifestSha256"] = String(repeating: "A", count: 64)
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ReviewWorkspace.self,
                from: JSONSerialization.data(withJSONObject: nonCanonical)
            )
        }
    }
}

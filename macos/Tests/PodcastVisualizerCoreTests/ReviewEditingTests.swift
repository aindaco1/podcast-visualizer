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

    private var speakers: [ReviewSpeaker] {
        [
            ReviewSpeaker(id: "speaker-01", displayName: "Speaker 1"),
            ReviewSpeaker(id: "speaker-03", displayName: "Speaker 3"),
        ]
    }

    @Test("adds the next safe speaker identity and renames only its display label")
    func editsSpeakerDefinitions() {
        let added = ReviewEditing.addSpeaker(to: speakers)
        #expect(added?.map(\.id) == ["speaker-01", "speaker-03", "speaker-02"])
        #expect(added?.last?.displayName == "Speaker 2")
        let renamed = ReviewEditing.renameSpeaker("speaker-01", to: "  Alonso  ", in: speakers)
        #expect(renamed?.first?.id == "speaker-01")
        #expect(renamed?.first?.displayName == "Alonso")
        #expect(ReviewEditing.renameSpeaker("speaker-01", to: "\n", in: speakers) == nil)
        let seventh = ReviewEditing.addSpeaker(to: (1...6).map {
            ReviewSpeaker(id: String(format: "speaker-%02d", $0), displayName: "Speaker \($0)")
        })
        #expect(seventh?.last?.id == "speaker-07")
        #expect(ReviewEditing.addSpeaker(to: (1...ReviewSpeaker.maximumCount).map {
            ReviewSpeaker(id: String(format: "speaker-%02d", $0), displayName: "Speaker \($0)")
        }) == nil)
    }

    @Test("merges one anonymous speaker globally without changing timing or text")
    func mergeSpeaker() {
        let merged = ReviewEditing.mergeSpeaker("speaker-03", into: "speaker-01", in: cues)
        #expect(merged.map(\.speakerLabel) == ["speaker-01", "speaker-01"])
        #expect(merged[1].speakerConfirmed)
        #expect(merged[1].textMarkdown == cues[1].textMarkdown)
        #expect(merged[1].startsAtMs == cues[1].startsAtMs)
    }

    @Test("deletes a speaker and reassigns its cues to unknown")
    func deletesSpeaker() {
        let result = ReviewEditing.deleteSpeaker("speaker-01", from: speakers, cues: cues)
        #expect(result?.speakers.map(\.id) == ["speaker-03"])
        #expect(result?.reassignedCueCount == 1)
        #expect(result?.cues[0].speakerLabel == "unknown")
        #expect(result?.cues[0].speakerConfirmed == false)
        #expect(result?.cues[0].speakerAmbiguous == true)
        #expect(result?.cues[1] == cues[1])
        #expect(ReviewEditing.deleteSpeaker("speaker-99", from: speakers, cues: cues) == nil)
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

    @Test("preserves every trailing cue and refuses stale cue identities across consecutive merges")
    func mergeNextCueByStableIdentity() {
        let fourCues = cues + [
            ReviewCue(
                id: "cue_000003", startsAtMs: 2400, endsAtMs: 3200,
                textMarkdown: "The following line stays.", speakerLabel: "speaker-01",
                speakerConfirmed: true, speakerConfidence: 0.95, speakerAmbiguous: false
            ),
            ReviewCue(
                id: "cue_000004", startsAtMs: 3400, endsAtMs: 4200,
                textMarkdown: "The final line stays too.", speakerLabel: "speaker-01",
                speakerConfirmed: true, speakerConfidence: 0.95, speakerAmbiguous: false
            ),
        ]

        let once = ReviewEditing.mergeNext(cueID: "cue_000001", in: fourCues)
        #expect(once.map(\.id) == ["cue_000001", "cue_000003", "cue_000004"])
        #expect(once[0].textMarkdown == "Lucid link is not lucid linked. A Lucid link costs $5.")
        #expect(once[1].textMarkdown == "The following line stays.")
        #expect(once[2].textMarkdown == "The final line stays too.")

        let staleRemovedRowAction = ReviewEditing.mergeNext(cueID: "cue_000002", in: once)
        #expect(staleRemovedRowAction == once)

        let twice = ReviewEditing.mergeNext(cueID: "cue_000001", in: once)
        #expect(twice.map(\.id) == ["cue_000001", "cue_000004"])
        #expect(twice[0].textMarkdown.hasSuffix("The following line stays."))
        #expect(twice[1].textMarkdown == "The final line stays too.")
    }

    @Test("splits one cue at an explicit word boundary and playhead")
    func splitCue() throws {
        let source = cues[0].textMarkdown
        let boundary = try #require(source.range(of: " is")?.lowerBound)
        let result = try ReviewEditing.splitCue(
            cueID: "cue_000001",
            at: 500,
            textBoundaryUTF16Offset: boundary.utf16Offset(in: source),
            in: cues
        ).get()

        #expect(result.cues.map(\.id) == ["cue_000001", "cue_000003", "cue_000002"])
        #expect(result.cues[0].startsAtMs == 0)
        #expect(result.cues[0].endsAtMs == 500)
        #expect(result.cues[1].startsAtMs == 500)
        #expect(result.cues[1].endsAtMs == 1_000)
        #expect(result.cues[0].textMarkdown == "Lucid link")
        #expect(result.cues[1].textMarkdown == "is not lucid linked.")
        #expect("\(result.cues[0].textMarkdown) \(result.cues[1].textMarkdown)" == source)
        #expect(result.cues[0].speakerLabel == result.cues[1].speakerLabel)
        #expect(result.cues[0].speakerConfirmed == result.cues[1].speakerConfirmed)
    }

    @Test("rejects unsafe split timing, missing word boundaries, and grapheme interiors")
    func rejectsUnsafeSplit() {
        let source = cues[0].textMarkdown
        #expect(ReviewEditing.splitCue(
            cueID: "cue_000001", at: 149,
            textBoundaryUTF16Offset: 5, in: cues
        ) == .failure(.unsafePlayhead))
        #expect(ReviewEditing.splitCue(
            cueID: "cue_000001", at: 500,
            textBoundaryUTF16Offset: 2, in: cues
        ) == .failure(.invalidTextBoundary))
        #expect(ReviewEditing.splitCue(
            cueID: "cue_999999", at: 500,
            textBoundaryUTF16Offset: 5, in: cues
        ) == .failure(.cueMissing))

        var emojiCue = cues[0]
        emojiCue.textMarkdown = "Hi 👩🏽‍💻 there"
        let emojiStart = emojiCue.textMarkdown.range(of: "👩🏽‍💻")!.lowerBound
        let insideEmoji = emojiStart.utf16Offset(in: emojiCue.textMarkdown) + 1
        #expect(ReviewEditing.splitCue(
            cueID: emojiCue.id, at: 500,
            textBoundaryUTF16Offset: insideEmoji, in: [emojiCue]
        ) == .failure(.invalidTextBoundary))
        #expect(source == cues[0].textMarkdown)
    }

    @Test("accepts exact split margins and refuses the maximum cue count")
    func splitBounds() throws {
        let source = cues[0].textMarkdown
        let boundary = try #require(source.range(of: " is")?.lowerBound)
        for playhead in [150, 850] {
            #expect(try ReviewEditing.splitCue(
                cueID: "cue_000001",
                at: playhead,
                textBoundaryUTF16Offset: boundary.utf16Offset(in: source),
                in: cues
            ).get().cues.count == 3)
        }
        let maximumCues = (1...10_000).map { index in
            ReviewCue(
                id: "cue_\(String(format: "%06d", index))",
                startsAtMs: (index - 1) * 1_000,
                endsAtMs: index * 1_000,
                textMarkdown: "one two",
                speakerLabel: "speaker-01",
                speakerConfirmed: true,
                speakerConfidence: 1,
                speakerAmbiguous: false
            )
        }
        #expect(ReviewEditing.splitCue(
            cueID: "cue_000001",
            at: 500,
            textBoundaryUTF16Offset: 3,
            in: maximumCues
        ) == .failure(.cueLimitReached))
    }

    @Test("merges with the previous chronological cue")
    func mergePreviousCue() {
        let merged = ReviewEditing.mergePrevious(cueID: "cue_000002", in: cues)
        #expect(merged.count == 1)
        #expect(merged[0].id == "cue_000001")
        #expect(ReviewEditing.mergePrevious(cueID: "cue_000001", in: cues) == cues)
    }

    @Test("propagates conservative confidence through split and merge")
    func confidenceEditing() {
        let thresholds = ReviewRecognitionConfidenceThresholds(
            ultraLowBelow: 0.5,
            lowBelow: 0.9,
            mediumBelow: 0.98
        )
        let confidence = ReviewRecognitionConfidence(
            thresholds: thresholds,
            cues: [
                ReviewCueRecognitionConfidence(
                    cueId: "cue_000001", tier: .low, score: 0.6, tokenCount: 2,
                    tokenEvidence: [
                        ReviewRecognitionTokenEvidence(startsAtMs: 100, endsAtMs: 200, score: 0.6),
                        ReviewRecognitionTokenEvidence(startsAtMs: 700, endsAtMs: 800, score: 0.99),
                    ]
                ),
                ReviewCueRecognitionConfidence(
                    cueId: "cue_000002", tier: .high, score: 0.99, tokenCount: 1,
                    tokenEvidence: [
                        ReviewRecognitionTokenEvidence(startsAtMs: 1_300, endsAtMs: 1_500, score: 0.99),
                    ]
                ),
            ]
        )
        let split = confidence.splitting(
            cueID: "cue_000001",
            rightCueID: "cue_000003",
            at: 500
        )
        #expect(split.cues.map(\.tier) == [.low, .high, .high])
        let merged = split.merging(leftCueID: "cue_000001", rightCueID: "cue_000003")
        #expect(merged.cues.map(\.cueId) == ["cue_000001", "cue_000002"])
        #expect(merged.cues[0].tier == .low)
        #expect(merged.cues[0].score == 0.6)
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

    @Test("indexes literal Unicode matches with stable cue IDs and UTF-16 ranges")
    func matchIndex() {
        var unicodeCues = cues
        unicodeCues[0].textMarkdown = "Café 👩🏽‍💻 caféine café"
        let matches = ReviewEditing.matches(
            "café",
            in: unicodeCues,
            caseSensitive: false,
            wholeWords: true
        )
        #expect(matches.count == 2)
        #expect(matches.allSatisfy { $0.cueID == "cue_000001" })
        let source = unicodeCues[0].textMarkdown as NSString
        #expect(matches.map { source.substring(with: $0.utf16Range) } == ["Café", "café"])
        let emoji = ReviewEditing.matches(
            "👩🏽‍💻",
            in: unicodeCues,
            caseSensitive: true,
            wholeWords: false
        )
        #expect(emoji.count == 1)
        #expect(emoji.first.map { source.substring(with: $0.utf16Range) } == "👩🏽‍💻")
    }

    @Test("wraps match navigation and refuses a stale current-match replacement")
    func matchNavigationAndStaleReplacement() {
        let matches = ReviewEditing.matches(
            "Lucid link",
            in: cues,
            caseSensitive: true,
            wholeWords: false
        )
        #expect(matches.count == 2)
        #expect(ReviewEditing.navigatedMatchIndex(current: nil, count: 2, direction: 1) == 0)
        #expect(ReviewEditing.navigatedMatchIndex(current: 1, count: 2, direction: 1) == 0)
        #expect(ReviewEditing.navigatedMatchIndex(current: 0, count: 2, direction: -1) == 1)
        let replaced = ReviewEditing.replace(
            matches[0],
            search: "Lucid link",
            with: "LucidLink",
            in: cues,
            caseSensitive: true,
            wholeWords: false
        )
        #expect(replaced.replacements == 1)
        #expect(replaced.cues[0].textMarkdown.hasPrefix("LucidLink"))
        let stale = ReviewEditing.replace(
            matches[0],
            search: "Lucid link",
            with: "Wrong",
            in: replaced.cues,
            caseSensitive: true,
            wholeWords: false
        )
        #expect(stale.replacements == 0)
        #expect(stale.cues == replaced.cues)
    }

    @Test("indexes a ten-thousand-cue transcript in one bounded pass")
    func largeMatchIndex() {
        let large = (1...10_000).map { index in
            ReviewCue(
                id: String(format: "cue_%06d", index),
                startsAtMs: (index - 1) * 10,
                endsAtMs: index * 10,
                textMarkdown: index.isMultiple(of: 100) ? "Find this phrase." : "No match here.",
                speakerLabel: "speaker-01",
                speakerConfirmed: true,
                speakerConfidence: 1,
                speakerAmbiguous: false
            )
        }
        let matches = ReviewEditing.matches(
            "Find this phrase",
            in: large,
            caseSensitive: true,
            wholeWords: false
        )
        #expect(matches.count == 100)
        #expect(matches.first?.cueID == "cue_000100")
        #expect(matches.last?.cueID == "cue_010000")
    }

    @Test("encodes absent transcript lineage as explicit null fields")
    func reviewEditPayloadNullLineageContract() throws {
        let payload = ReviewEditPayload(
            parentDraftSha256: String(repeating: "a", count: 64),
            baseTranscriptId: nil,
            baseRevisionSha256: nil,
            speakers: speakers,
            cues: cues
        )
        let object = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
        )

        #expect(object.keys.contains("baseTranscriptId"))
        #expect(object["baseTranscriptId"] is NSNull)
        #expect(object.keys.contains("baseRevisionSha256"))
        #expect(object["baseRevisionSha256"] is NSNull)
        #expect((object["reflowBoundaryHints"] as? [[String: Any]])?.isEmpty == true)
    }

    @Test("decodes a bounded versioned native review workspace")
    func workspaceContract() throws {
        let value: [String: Any] = [
            "schemaVersion": ReviewWorkspace.schema,
            "projectRoot": "/Users/example/project",
            "draftManifestSha256": String(repeating: "a", count: 64),
            "baseTranscriptId": NSNull(),
            "baseRevisionSha256": NSNull(),
            "audioPath": "/Users/example/project/source/review.wav",
            "durationMs": 2200,
            "speakers": (speakers + [ReviewSpeaker(id: "speaker-07", displayName: "Producer")])
                .map { ["id": $0.id, "displayName": $0.displayName] },
            "cues": cues.map { cue in
                [
                    "id": cue.id, "startsAtMs": cue.startsAtMs, "endsAtMs": cue.endsAtMs,
                    "textMarkdown": cue.textMarkdown, "speakerLabel": cue.speakerLabel,
                    "speakerConfirmed": cue.speakerConfirmed,
                    "speakerConfidence": cue.speakerConfidence,
                    "speakerAmbiguous": cue.speakerAmbiguous,
                ] as [String: Any]
            },
            "checkedCueIds": ["cue_000001"],
            "editedCueIds": ["cue_000002"],
            "recognitionConfidence": [
                "schemaVersion": ReviewRecognitionConfidence.schema,
                "policyVersion": ReviewRecognitionConfidence.policy,
                "thresholds": [
                    "ultraLowBelow": 0.5,
                    "lowBelow": 0.9,
                    "mediumBelow": 0.98,
                ],
                "cues": cues.map { cue in
                    [
                        "cueId": cue.id,
                        "tier": "high",
                        "score": 0.99,
                        "tokenCount": 1,
                        "tokenEvidence": [[
                            "startsAtMs": cue.startsAtMs,
                            "endsAtMs": cue.endsAtMs,
                            "score": 0.99,
                        ]],
                    ] as [String: Any]
                },
            ] as [String: Any],
            "hasWorkingCopy": false,
        ]
        let data = try JSONSerialization.data(withJSONObject: value)
        let workspace = try ContractDecoder.decode(ReviewWorkspace.self, from: data)
        #expect(workspace.cues.count == 2)
        #expect(workspace.speakers.last?.id == "speaker-07")
        #expect(workspace.speakers[0].displayName == "Speaker 1")
        #expect(workspace.audioPath.hasSuffix("review.wav"))
        #expect(workspace.checkedCueIds == ["cue_000001"])
        #expect(workspace.editedCueIds == ["cue_000002"])
        #expect(workspace.recognitionConfidence.cues.count == 2)
        var nonCanonical = value
        nonCanonical["draftManifestSha256"] = String(repeating: "A", count: 64)
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ReviewWorkspace.self,
                from: JSONSerialization.data(withJSONObject: nonCanonical)
            )
        }
        var duplicateCueID = value
        var duplicateCues = duplicateCueID["cues"] as! [[String: Any]]
        duplicateCues[1]["id"] = duplicateCues[0]["id"]
        duplicateCueID["cues"] = duplicateCues
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ReviewWorkspace.self,
                from: JSONSerialization.data(withJSONObject: duplicateCueID)
            )
        }
        var inconsistentEvidence = value
        var confidence = inconsistentEvidence["recognitionConfidence"] as! [String: Any]
        var confidenceCues = confidence["cues"] as! [[String: Any]]
        var evidence = confidenceCues[0]["tokenEvidence"] as! [[String: Any]]
        evidence[0]["score"] = 0.98
        confidenceCues[0]["tokenEvidence"] = evidence
        confidence["cues"] = confidenceCues
        inconsistentEvidence["recognitionConfidence"] = confidence
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ReviewWorkspace.self,
                from: JSONSerialization.data(withJSONObject: inconsistentEvidence)
            )
        }
    }
}

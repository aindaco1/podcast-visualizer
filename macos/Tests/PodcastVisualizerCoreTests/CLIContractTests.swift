import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("CLI contracts")
struct CLIContractTests {
    @Test("decodes every frozen success fixture")
    func successFixtures() throws {
        let probe = try TestSupport.decodeFixture("probe", as: MediaProbeResult.self)
        #expect(probe.schemaVersion == MediaProbeResult.schema)
        #expect(probe.sourcePath.hasPrefix("/"))
        #expect(try TestSupport.decodeFixture("init", as: InitResult.self).state == "initialized")
        #expect(try TestSupport.decodeFixture("status", as: StatusResult.self).clip.durationMs == 1_000)
        #expect(!(try TestSupport.decodeFixture(
            "branding load", as: ProjectBrandingWorkspace.self
        ).hasSavedSettings))
        #expect(try TestSupport.decodeFixture(
            "branding save", as: ProjectBrandingWorkspace.self
        ).logo?.width == 1_024)
        #expect(try TestSupport.decodeFixture("prepare", as: PrepareResult.self).analysisPath.hasPrefix("/"))
        #expect(try TestSupport.decodeFixture("analyze", as: AnalyzeResult.self).speakers == 2)
        #expect(try TestSupport.decodeFixture("review", as: ReviewResult.self).state == "approved")
        #expect(try TestSupport.decodeFixture("review load", as: ReviewWorkspace.self).cues.count == 1)
        #expect(try TestSupport.decodeFixture("review save", as: ReviewSaveResult.self).ok)
        #expect(try TestSupport.decodeFixture("review approve", as: NativeReviewApprovalResult.self).state == "approved")
        #expect(try TestSupport.decodeFixture("align", as: AlignResult.self).quality.structurallyEligible)
        #expect(try TestSupport.decodeFixture(
            "chapters load", as: ChapterWorkspace.self
        ).contextArtifact.context.windows.first?.records.count == 3)
        #expect(try TestSupport.decodeFixture("chapters save", as: ChapterSaveResult.self).entries == 3)
        #expect(try TestSupport.decodeFixture(
            "chapters approve", as: ChapterApprovalResult.self
        ).state == "approved")
        #expect(try TestSupport.decodeFixture(
            "chapters export", as: ChapterExportResult.self
        ).content.hasPrefix("00:00"))
        #expect(try TestSupport.decodeFixture("render", as: [RenderResult].self).first?.width == 1_920)
        #expect(try TestSupport.decodeFixture("models status", as: ModelStatusResult.self).ok)
        #expect(!(try TestSupport.decodeFixture("models import", as: ModelImportResult.self).reused))
        #expect(try TestSupport.decodeFixture("doctor", as: DoctorResult.self).ok)
    }

    @Test("decodes every frozen error fixture")
    func errorFixtures() throws {
        let data = try Data(contentsOf: TestSupport.fixtureRoot.appendingPathComponent("errors.json"))
        let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let fixtures = root["fixtures"] as! [[String: Any]]
        #expect(fixtures.count == 20)
        for fixture in fixtures {
            let value: [String: Any] = [
                "schemaVersion": CLIErrorResult.schema,
                "command": fixture["command"]!,
                "exitCode": fixture["exitCode"]!,
                "error": fixture["error"]!,
            ]
            let result = try ContractDecoder.decode(
                CLIErrorResult.self,
                from: JSONSerialization.data(withJSONObject: value),
                maximumBytes: 256 * 1024
            )
            #expect(result.exitCode > 0)
        }
    }

    @Test("decodes a bounded optional diagnostic code")
    func diagnosticErrorCode() throws {
        let result = try ContractDecoder.decode(
            CLIErrorResult.self,
            from: Data(#"{"schemaVersion":"podcast-visualizer-error-v1","command":"init","exitCode":2,"error":{"code":"usage","diagnosticCode":"project_name_unsafe","message":"project directory name is unsafe","hint":"Choose another name."}}"#.utf8)
        )
        #expect(result.error.diagnosticCode == "project_name_unsafe")

        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                CLIErrorResult.self,
                from: Data(#"{"schemaVersion":"podcast-visualizer-error-v1","command":"init","exitCode":2,"error":{"code":"usage","diagnosticCode":"../../private","message":"unsafe","hint":null}}"#.utf8)
            )
        }
    }

    @Test("decodes bounded progress while tolerating unknown fields and events")
    func progressFixtures() throws {
        let text = try String(
            contentsOf: TestSupport.fixtureRoot.appendingPathComponent("progress.ndjson"),
            encoding: .utf8
        )
        let lines = text.split(separator: "\n")
        let events = try lines.map {
            try ContractDecoder.decode(CLIProgressEvent.self, from: Data($0.utf8), maximumBytes: 8 * 1024)
        }
        #expect(events.map(\.sequence) == [1, 2, 3])
        #expect(events[1].detail.reviewURL?.hasPrefix("http://127.0.0.1:") == true)

        var unknown = try JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as! [String: Any]
        unknown["futureField"] = true
        unknown["event"] = "future.stage"
        let decoded = try ContractDecoder.decode(
            CLIProgressEvent.self,
            from: JSONSerialization.data(withJSONObject: unknown),
            maximumBytes: 8 * 1024
        )
        #expect(decoded.event == "future.stage")

        let render = try ContractDecoder.decode(
            CLIProgressEvent.self,
            from: Data(#"{"schemaVersion":"podcast-visualizer-progress-v1","sequence":4,"command":"render","event":"render.progress","detail":{"phase":"encoding","fraction":0.625,"processedMs":6250,"outputIndex":2,"totalOutputs":3}}"#.utf8),
            maximumBytes: 8 * 1024
        )
        #expect(render.detail.fraction == 0.625)
        #expect(render.detail.outputIndex == 2)
        #expect(ProgressPresentation(detail: render.detail)?.label == "Encoding video")
    }

    @Test("rejects unsupported schemas and oversized results")
    func rejectsBadSchemasAndBounds() throws {
        var probe = try TestSupport.successOutputs()["probe"] as! [String: Any]
        probe["schemaVersion"] = "podcast-visualizer-media-probe-v2"
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(MediaProbeResult.self, from: JSONSerialization.data(withJSONObject: probe))
        }
        var chapters = try TestSupport.successOutputs()["chapters load"] as! [String: Any]
        var artifact = chapters["contextArtifact"] as! [String: Any]
        var context = artifact["context"] as! [String: Any]
        var windows = context["windows"] as! [[String: Any]]
        var records = windows[0]["records"] as! [[String: Any]]
        records[0]["unexpected"] = "untrusted"
        windows[0]["records"] = records
        context["windows"] = windows
        artifact["context"] = context
        chapters["contextArtifact"] = artifact
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ChapterWorkspace.self,
                from: JSONSerialization.data(withJSONObject: chapters)
            )
        }
        var duplicateEdit = try TestSupport.successOutputs()["chapters load"] as! [String: Any]
        var edit = duplicateEdit["edit"] as! [String: Any]
        let duplicateEntry: [String: Any] = [
            "anchorId": "chapter_anchor_cue_000001", "title": "Opening",
        ]
        edit["entries"] = [duplicateEntry, duplicateEntry]
        duplicateEdit["edit"] = edit
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ChapterWorkspace.self,
                from: JSONSerialization.data(withJSONObject: duplicateEdit)
            )
        }
        var mismatchedAnchor = try TestSupport.successOutputs()["chapters load"] as! [String: Any]
        var mismatchedArtifact = mismatchedAnchor["contextArtifact"] as! [String: Any]
        var mismatchedContext = mismatchedArtifact["context"] as! [String: Any]
        var mismatchedWindows = mismatchedContext["windows"] as! [[String: Any]]
        var mismatchedRecords = mismatchedWindows[0]["records"] as! [[String: Any]]
        mismatchedRecords[1]["startsAtMs"] = 60_001
        mismatchedWindows[0]["records"] = mismatchedRecords
        mismatchedContext["windows"] = mismatchedWindows
        mismatchedArtifact["context"] = mismatchedContext
        mismatchedAnchor["contextArtifact"] = mismatchedArtifact
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ChapterWorkspace.self,
                from: JSONSerialization.data(withJSONObject: mismatchedAnchor)
            )
        }
        var untrustedApproval = try TestSupport.successOutputs()["chapters load"] as! [String: Any]
        let untrustedArtifact = untrustedApproval["contextArtifact"] as! [String: Any]
        let untrustedContext = untrustedArtifact["context"] as! [String: Any]
        let untrustedWindows = untrustedContext["windows"] as! [[String: Any]]
        let untrustedRecords = untrustedWindows[0]["records"] as! [[String: Any]]
        let compiled = untrustedRecords.enumerated().map { index, record -> [String: Any] in
            [
                "anchorId": record["anchorId"]!,
                "sourceCueId": record["sourceCueId"]!,
                "sourceWordId": record["sourceWordId"]!,
                "startsAtMs": record["startsAtMs"]!,
                "title": index == 1 ? " Main topic " : (index == 0 ? "Opening" : "Closing"),
            ]
        }
        untrustedApproval["approved"] = [
            "schemaVersion": "podcast-visualizer-approved-chapters-v1",
            "chapterRevisionId": "chapters_aaaaaaaaaaaaaaaaaaaaaaaa",
            "contextId": untrustedArtifact["contextId"]!,
            "contextManifestSha256": untrustedArtifact["manifestSha256"]!,
            "list": [
                "schemaVersion": "timed-text-chapter-list-v1",
                "mode": "topics",
                "durationMs": 180_000,
                "policyVersion": "chapter-context-v1",
                "chapters": compiled,
            ],
            "manifestSha256": String(repeating: "a", count: 64),
        ]
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                ChapterWorkspace.self,
                from: JSONSerialization.data(withJSONObject: untrustedApproval)
            )
        }
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(DoctorResult.self, from: Data(repeating: 0x20, count: 33), maximumBytes: 32)
        }
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(
                CLIProgressEvent.self,
                from: Data(#"{"schemaVersion":"podcast-visualizer-progress-v1","sequence":1,"command":"render","event":"render.progress","detail":{"phase":"encoding","fraction":1.5}}"#.utf8)
            )
        }
    }
}

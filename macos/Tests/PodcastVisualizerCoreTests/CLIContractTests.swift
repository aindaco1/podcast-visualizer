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
        #expect(try TestSupport.decodeFixture("prepare", as: PrepareResult.self).analysisPath.hasPrefix("/"))
        #expect(try TestSupport.decodeFixture("analyze", as: AnalyzeResult.self).speakers == 2)
        #expect(try TestSupport.decodeFixture("review", as: ReviewResult.self).state == "approved")
        #expect(try TestSupport.decodeFixture("align", as: AlignResult.self).quality.structurallyEligible)
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
        #expect(fixtures.count == 11)
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
    }

    @Test("rejects unsupported schemas and oversized results")
    func rejectsBadSchemasAndBounds() throws {
        var probe = try TestSupport.successOutputs()["probe"] as! [String: Any]
        probe["schemaVersion"] = "podcast-visualizer-media-probe-v2"
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(MediaProbeResult.self, from: JSONSerialization.data(withJSONObject: probe))
        }
        #expect(throws: ContractDecodingError.self) {
            try ContractDecoder.decode(DoctorResult.self, from: Data(repeating: 0x20, count: 33), maximumBytes: 32)
        }
    }
}

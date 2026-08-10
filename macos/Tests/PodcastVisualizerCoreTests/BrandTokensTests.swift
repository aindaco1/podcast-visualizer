import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Brand tokens")
struct BrandTokensTests {
    @Test("loads the neutral repository resource")
    func loadsResource() throws {
        let url = TestSupport.repositoryRoot.appendingPathComponent("resources/brand/dust-wave-v1.json")
        let tokens = try BrandTokens.load(from: url)
        #expect(tokens.schemaVersion == BrandTokens.schema)
        #expect(tokens.speakers.count == 6)
        #expect(tokens.fonts.transcript == "Inter")
    }

    @Test("rejects unknown fields and symlinks")
    func rejectsUnsafeResources() throws {
        let source = TestSupport.repositoryRoot.appendingPathComponent("resources/brand/dust-wave-v1.json")
        var object = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [String: Any]
        object["unexpected"] = true
        #expect(throws: BrandTokenError.unexpectedFields) {
            try BrandTokens.decode(JSONSerialization.data(withJSONObject: object))
        }

        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let link = root.appendingPathComponent("brand.json")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
        #expect(throws: BrandTokenError.unsafeResource) { try BrandTokens.load(from: link) }
    }
}

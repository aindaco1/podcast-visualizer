import Foundation
@testable import PodcastVisualizerCore

enum TestSupport {
    static var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    static var fixtureRoot: URL {
        repositoryRoot.appendingPathComponent("test/fixtures/cli-contract/v1", isDirectory: true)
    }

    static func successOutputs() throws -> [String: Any] {
        let data = try Data(contentsOf: fixtureRoot.appendingPathComponent("success.json"))
        let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let fixtures = root["fixtures"] as! [[String: Any]]
        return Dictionary(uniqueKeysWithValues: fixtures.map { ($0["command"] as! String, $0["output"]!) })
    }

    static func decodeFixture<Value: Decodable>(_ command: String, as type: Value.Type) throws -> Value {
        let output = try successOutputs()[command]!
        return try ContractDecoder.decode(type, from: JSONSerialization.data(withJSONObject: output))
    }
}

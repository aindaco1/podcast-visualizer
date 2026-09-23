import Foundation
import FoundationModels

// Test-only provenance. Never infer a model identity from the OS version.
struct AppleEvaluationMetadata: Encodable {
    let osVersion: String
    let models: [Model]

    struct Model: Encodable {
        let useCase: String
        let available: Bool
        var displayName: String?
        var contextSize: Int?
        var capabilities: [String]?
    }

    static func current() -> Self {
        let models = ["general", "contentTagging"].map { useCase in
            var result = Model(useCase: useCase, available: false)
            if #available(macOS 26.0, *) {
                let model = SystemLanguageModel(useCase: useCase == "general" ? .general : .contentTagging)
                result = Model(useCase: useCase, available: model.availability == .available)
                #if compiler(>=6.4)
                if #available(macOS 27.0, *) {
                    result.displayName = model.variant.displayName
                    result.contextSize = model.contextSize
                    result.capabilities = [
                        ("guidedGeneration", model.capabilities.contains(.guidedGeneration)),
                        ("toolCalling", model.capabilities.contains(.toolCalling)),
                        ("reasoning", model.capabilities.contains(.reasoning)),
                        ("vision", model.capabilities.contains(.vision)),
                    ].compactMap { $0.1 ? $0.0 : nil }
                }
                #endif
            }
            return result
        }
        return Self(osVersion: ProcessInfo.processInfo.operatingSystemVersionString, models: models)
    }
}

func writeAppleEvaluationJSON<T: Encodable>(_ value: T, to url: URL) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    try encoder.encode(value).write(to: url, options: .withoutOverwriting)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}

import CryptoKit
import Foundation
import FoundationModels
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@Suite("Synthetic Apple formatting comparison")
struct AppleFormattingComparisonTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["PODCAST_VISUALIZER_APPLE_CAPTURE"] != nil))
    func compareModelsAndBatchSizes() async throws {
        let directory = URL(fileURLWithPath: try #require(
            ProcessInfo.processInfo.environment["PODCAST_VISUALIZER_APPLE_CAPTURE"]
        ), isDirectory: true)
        let url = directory.appendingPathComponent("native-input.json")
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        try #require(values.isRegularFile == true && values.isSymbolicLink != true && (values.fileSize ?? 0) <= 128_000)
        let input = try JSONDecoder().decode([Input].self, from: Data(contentsOf: url))
        try writeAppleEvaluationJSON(AppleEvaluationMetadata.current(), to: directory.appendingPathComponent("apple-models.json"))
        var rows: [Batch] = []
        if #available(macOS 26.0, *) {
            // Freeze serialized prompts once. Both use cases and both repetitions receive identical bytes.
            for item in input {
                let candidates = DialogueBoundaryAdvicePolicy.candidates(from: item.cues)
                try #require(candidates.count == 24)
                // Keep the historical baseline fixed when the app's default changes.
                for size in [24, 6] {
                    let batches = try stride(from: 0, to: candidates.count, by: size).map { start in
                        let batch = Array(candidates[start..<min(start + size, candidates.count)])
                        return (batch, try OnDeviceDialogueBoundaryAdviser.prompt(for: batch))
                    }
                    for repetition in 1...2 {
                        // Reverse model order on the repeat; timings remain descriptive, not a benchmark.
                        for useCase in repetition == 1 ? ["contentTagging", "general"] : ["general", "contentTagging"] {
                            let model = SystemLanguageModel(useCase: useCase == "general" ? .general : .contentTagging)
                            for (index, pair) in batches.enumerated() {
                                let row = await capture(itemID: item.id, size: size, repetition: repetition,
                                    useCase: useCase, batchIndex: index, candidates: pair.0, prompt: pair.1, model: model)
                                // One immutable checkpoint per attempted batch, including failures.
                                try writeAppleEvaluationJSON(row, to: directory.appendingPathComponent(String(format: "batch-%03d.json", rows.count)))
                                rows.append(row)
                            }
                        }
                    }
                }
            }
        }
        try writeAppleEvaluationJSON(rows, to: directory.appendingPathComponent("native-output.json"))
    }

    @available(macOS 26.0, *)
    private func capture(itemID: String, size: Int, repetition: Int, useCase: String, batchIndex: Int,
                         candidates: [DialogueBoundaryCandidate], prompt: String, model: SystemLanguageModel) async -> Batch {
        var row = Batch(caseID: itemID, useCase: useCase, batchSize: size, repetition: repetition,
            batchIndex: batchIndex, candidateIDs: candidates.map(\.afterCueId),
            promptSHA256: SHA256.hash(data: Data(prompt.utf8)).map { String(format: "%02x", $0) }.joined(),
            promptCharacters: prompt.count)
        guard model.availability == .available else { row.error = "model_unavailable"; return row }
        #if compiler(>=6.4)
        if #available(macOS 27.0, *) {
            // Counts exclude response generation and are diagnostic; actual usage is kept separately.
            do {
                row.promptTokens = try await model.tokenCount(for: Prompt(prompt))
                row.instructionTokens = try await model.tokenCount(for: Instructions(OnDeviceDialogueBoundaryAdviser.instructions))
                row.schemaTokens = try await model.tokenCount(for: GeneratedBoundaryResponse.generationSchema)
            } catch { row.tokenCountError = true }
        }
        #endif
        let start = ContinuousClock.now
        do {
            let response = try await OnDeviceDialogueBoundaryAdviser.respond(to: prompt, model: model)
            row.decisions = response.content.decisions.map { Decision(afterCueId: $0.afterCueId, action: $0.action) }
            #if compiler(>=6.4)
            if #available(macOS 27.0, *) {
                row.inputTokens = response.usage.input.totalTokenCount
                row.outputTokens = response.usage.output.totalTokenCount
            }
            #endif
        } catch {
            row.error = errorCode(error)
        }
        let elapsed = start.duration(to: .now).components
        row.elapsedMilliseconds = Double(elapsed.seconds) * 1_000 + Double(elapsed.attoseconds) / 1e15
        return row
    }

    @available(macOS 26.0, *)
    private func errorCode(_ error: any Error) -> String {
        #if compiler(>=6.4)
        if #available(macOS 27.0, *), let failure = error as? LanguageModelError {
            if case .contextSizeExceeded = failure { return "context_window_exceeded" }
        }
        #endif
        if let failure = error as? LanguageModelSession.GenerationError,
           case .exceededContextWindowSize = failure { return "context_window_exceeded" }
        return "generation_failed"
    }

    private struct Input: Decodable { let id: String; let cues: [ReviewCue] }
    private struct Decision: Encodable { let afterCueId: String; let action: String }
    private struct Batch: Encodable {
        let caseID: String
        let useCase: String
        let batchSize: Int
        let repetition: Int
        let batchIndex: Int
        let candidateIDs: [String]
        let promptSHA256: String
        let promptCharacters: Int
        var promptTokens: Int?
        var instructionTokens: Int?
        var schemaTokens: Int?
        var tokenCountError = false
        var inputTokens: Int?
        var outputTokens: Int?
        var elapsedMilliseconds = 0.0
        var decisions: [Decision] = []
        var error = ""
    }
}

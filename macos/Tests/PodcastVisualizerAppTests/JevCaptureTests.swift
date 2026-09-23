import Foundation
import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

// Opt-in developer capture, never compiled into the app. The JS runner supplies
// only its allowlisted synthetic context and checks it again before any upload.
@Suite("Synthetic Jev candidate capture")
struct JevCaptureTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["PODCAST_VISUALIZER_JEV_CAPTURE"] != nil))
    func captureSyntheticCandidates() async throws {
        let directory = URL(fileURLWithPath: try #require(
            ProcessInfo.processInfo.environment["PODCAST_VISUALIZER_JEV_CAPTURE"]
        ), isDirectory: true)
        let inputURL = directory.appendingPathComponent("native-input.json")
        let values = try inputURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        try #require(values.isRegularFile == true && values.isSymbolicLink != true)
        try #require((values.fileSize ?? 0) <= 128_000)
        let input = try JSONDecoder().decode(Input.self, from: Data(contentsOf: inputURL))
        try writeAppleEvaluationJSON(AppleEvaluationMetadata.current(),
            to: directory.appendingPathComponent("apple-models.json"))
        var chapters: [ChapterResult] = []
        for item in input.chapters {
            do {
                let advice = try await OnDeviceChapterAdviser().advise(context: item.context)
                chapters.append(ChapterResult(id: item.id, entries: advice.entries,
                    usedOnDeviceModel: advice.usedOnDeviceModel, skippedWindows: advice.skippedWindows, error: ""))
            } catch {
                chapters.append(ChapterResult(id: item.id, entries: [],
                    usedOnDeviceModel: false, skippedWindows: 0, error: "native_generation_failed"))
            }
        }
        var dialogue: [DialogueResult] = []
        for item in input.dialogue {
            do {
                let advice = try await OnDeviceDialogueBoundaryAdviser().advise(cues: item.cues)
                dialogue.append(DialogueResult(id: item.id, hints: advice.hints,
                    usedOnDeviceModel: advice.usedOnDeviceModel, error: ""))
            } catch {
                dialogue.append(DialogueResult(id: item.id, hints: [],
                    usedOnDeviceModel: false, error: "native_generation_failed"))
            }
        }
        let bytes = try JSONEncoder().encode(Output(chapters: chapters, dialogue: dialogue))
        let outputURL = directory.appendingPathComponent("native-output.json")
        try bytes.write(to: outputURL, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: outputURL.path)
    }

    private struct Input: Decodable {
        let chapters: [ChapterInput]
        let dialogue: [DialogueInput]
    }
    private struct ChapterInput: Decodable {
        let id: String
        let context: ChapterContextArtifact
    }
    private struct DialogueInput: Decodable {
        let id: String
        let cues: [ReviewCue]
    }
    private struct Output: Encodable {
        let chapters: [ChapterResult]
        let dialogue: [DialogueResult]
    }
    private struct ChapterResult: Encodable {
        let id: String
        let entries: [ChapterEntry]
        let usedOnDeviceModel: Bool
        let skippedWindows: Int
        let error: String
    }
    private struct DialogueResult: Encodable {
        let id: String
        let hints: [ReviewReflowBoundaryHint]
        let usedOnDeviceModel: Bool
        let error: String
    }
}

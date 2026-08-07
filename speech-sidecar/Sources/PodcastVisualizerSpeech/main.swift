import CryptoKit
import Foundation
import RecordCore
import RecordSpeech

private let schemaVersion = "podcast-visualizer-speech-v1"
private let fluidAudioVersion = "0.15.5"
private let settingsVersion = "podcast-visualizer-speech-v1"

private enum SidecarError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case unsafeFile(String)
    case unsupportedArchitecture

    var description: String {
        switch self {
        case .invalidArguments(let message): message
        case .unsafeFile(let message): message
        case .unsupportedArchitecture: "speech analysis requires Apple Silicon"
        }
    }
}

private struct Options {
    let audio: URL
    let parakeetModel: URL
    let diarizationModelRoot: URL
    let output: URL
    let maximumSpeakers: Int

    static func parse(_ arguments: [String]) throws -> Options {
        var values: [String: String] = [:]
        let allowed = Set(["audio", "parakeet-model", "diarization-model-root", "output", "maximum-speakers"])
        var index = 0
        while index < arguments.count {
            let token = arguments[index]
            guard token.hasPrefix("--"), token.count > 2 else {
                throw SidecarError.invalidArguments("unexpected positional argument: \(token)")
            }
            let name = String(token.dropFirst(2))
            guard allowed.contains(name) else {
                throw SidecarError.invalidArguments("unknown option: --\(name)")
            }
            guard values[name] == nil else {
                throw SidecarError.invalidArguments("option repeated: --\(name)")
            }
            index += 1
            guard index < arguments.count, !arguments[index].hasPrefix("--") else {
                throw SidecarError.invalidArguments("--\(name) requires a value")
            }
            values[name] = arguments[index]
            index += 1
        }
        for name in ["audio", "parakeet-model", "diarization-model-root", "output"] where values[name] == nil {
            throw SidecarError.invalidArguments("missing required option: --\(name)")
        }
        guard let maximumSpeakers = Int(values["maximum-speakers"] ?? "6"), (1...6).contains(maximumSpeakers) else {
            throw SidecarError.invalidArguments("--maximum-speakers must be an integer from 1 through 6")
        }
        return Options(
            audio: URL(fileURLWithPath: values["audio"]!),
            parakeetModel: URL(fileURLWithPath: values["parakeet-model"]!),
            diarizationModelRoot: URL(fileURLWithPath: values["diarization-model-root"]!),
            output: URL(fileURLWithPath: values["output"]!),
            maximumSpeakers: maximumSpeakers
        )
    }
}

private struct EngineIdentity: Codable {
    let name: String
    let version: String
    let model: String
    let modelVersion: String
    let settingsVersion: String
}

private struct SpeechAnalysis: Codable {
    let schemaVersion: String
    let sourceAudioSha256: String
    let transcriptionEngine: EngineIdentity
    let diarizationEngine: EngineIdentity
    let transcript: ParakeetTranscriptResult
    let speakerTurns: [AnonymousSpeakerTurn]
}

private func requireRegularFile(_ url: URL, label: String) throws {
    let path = url.standardizedFileURL.path
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? 0) > 0 else {
        throw SidecarError.unsafeFile("\(label) must be a non-empty regular file: \(path)")
    }
}

private func requireDirectory(_ url: URL, label: String) throws {
    let path = url.standardizedFileURL.path
    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else {
        throw SidecarError.unsafeFile("\(label) must be a directory, not a symlink: \(path)")
    }
}

private func sha256(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var digest = SHA256()
    while true {
        let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
        if data.isEmpty { break }
        digest.update(data: data)
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

@main
private enum PodcastVisualizerSpeech {
    static func main() async {
        do {
            #if !arch(arm64)
            throw SidecarError.unsupportedArchitecture
            #endif
            let options = try Options.parse(Array(CommandLine.arguments.dropFirst()))
            try requireRegularFile(options.audio, label: "analysis audio")
            try requireDirectory(options.parakeetModel, label: "Parakeet model")
            try requireDirectory(options.diarizationModelRoot, label: "diarization model root")

            RecordFluidAudioOfflinePolicy.enforce()
            try ParakeetModelVerifier.validateV3(at: options.parakeetModel)
            let transcriber = ParakeetTranscriber(model: .v3)
            try await transcriber.prepare(modelDirectory: options.parakeetModel)
            let transcript = try await transcriber.transcribe(options.audio)
            await transcriber.release()

            let diarizer = OfflineSpeakerDiarizer(maximumSpeakers: options.maximumSpeakers)
            try await diarizer.prepare(modelDirectory: options.diarizationModelRoot)
            let turns = try await diarizer.diarize(options.audio)

            let analysis = SpeechAnalysis(
                schemaVersion: schemaVersion,
                sourceAudioSha256: try sha256(options.audio),
                transcriptionEngine: EngineIdentity(
                    name: "FluidAudio Parakeet TDT",
                    version: fluidAudioVersion,
                    model: "parakeet-tdt-0.6b-v3",
                    modelVersion: "aed02740059203c4a87495924f685de3722ae9ce",
                    settingsVersion: settingsVersion
                ),
                diarizationEngine: EngineIdentity(
                    name: "FluidAudio OfflineDiarizer",
                    version: fluidAudioVersion,
                    model: "speaker-diarization-coreml",
                    modelVersion: "1ed7a662fdc7109e36d822db793ee6eebdaf8594",
                    settingsVersion: settingsVersion
                ),
                transcript: transcript,
                speakerTurns: turns
            )
            let data = try JSONEncoder().encode(analysis)
            try data.write(to: options.output, options: [.withoutOverwriting])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: options.output.path)
        } catch {
            FileHandle.standardError.write(Data("podcast-visualizer-speech: \(error)\n".utf8))
            Foundation.exit(1)
        }
    }
}

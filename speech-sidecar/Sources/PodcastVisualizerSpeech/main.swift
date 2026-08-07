import CryptoKit
import Foundation
import RecordCore
import RecordSpeech

private let schemaVersion = "podcast-visualizer-speech-v1"
private let fluidAudioVersion = "0.15.5"
private let settingsVersion = "podcast-visualizer-speech-v1"
private let parakeetManifestSchema = "podcast-visualizer-parakeet-manifest-v1"
private let progressSchema = "podcast-visualizer-speech-progress-v1"

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

private struct VerificationOptions {
    let model: URL
    let output: URL

    static func parse(_ arguments: [String]) throws -> VerificationOptions {
        guard arguments.first == "verify-parakeet" else {
            throw SidecarError.invalidArguments("expected verify-parakeet command")
        }
        var values: [String: String] = [:]
        var index = 1
        while index < arguments.count {
            let token = arguments[index]
            guard ["--model", "--output"].contains(token), values[token] == nil else {
                throw SidecarError.invalidArguments("invalid verification option: \(token)")
            }
            index += 1
            guard index < arguments.count, !arguments[index].hasPrefix("--") else {
                throw SidecarError.invalidArguments("\(token) requires a value")
            }
            values[token] = arguments[index]
            index += 1
        }
        guard let model = values["--model"], let output = values["--output"] else {
            throw SidecarError.invalidArguments("verify-parakeet requires --model and --output")
        }
        return VerificationOptions(model: URL(fileURLWithPath: model), output: URL(fileURLWithPath: output))
    }
}

private struct ParakeetFileEvidence: Codable {
    let path: String
    let bytes: Int64
    let sha256: String
}

private struct ParakeetManifestEvidence: Codable {
    let schemaVersion: String
    let model: String
    let sourceRevision: String
    let localFolderName: String
    let files: [ParakeetFileEvidence]
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

private struct SpeechProgress: Codable {
    let schemaVersion: String
    let sequence: Int
    let phase: String
    let fraction: Double?
}

private final class SpeechProgressReporter: @unchecked Sendable {
    private let lock = NSLock()
    private var sequence = 0
    private var lastPhase: String?
    private var lastFraction: Double?

    func report(phase: String, fraction: Double? = nil) {
        lock.withLock {
            let bounded = fraction.map { min(1, max(0, $0)) }
            if phase == lastPhase, bounded == lastFraction { return }
            if phase == lastPhase, let bounded, let lastFraction,
               bounded < 1, bounded - lastFraction < 0.001 {
                return
            }
            sequence += 1
            lastPhase = phase
            lastFraction = bounded
            let value = SpeechProgress(
                schemaVersion: progressSchema,
                sequence: sequence,
                phase: phase,
                fraction: bounded
            )
            guard let data = try? JSONEncoder().encode(value) else { return }
            try? FileHandle.standardOutput.write(contentsOf: data + Data([0x0A]))
        }
    }
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
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.first == "verify-parakeet" {
                let options = try VerificationOptions.parse(arguments)
                try requireDirectory(options.model, label: "Parakeet model")
                RecordFluidAudioOfflinePolicy.enforce()
                try ParakeetModelVerifier.validateV3(at: options.model)
                let manifest = ParakeetModelManifest.v3
                let evidence = ParakeetManifestEvidence(
                    schemaVersion: parakeetManifestSchema,
                    model: manifest.model.rawValue,
                    sourceRevision: manifest.sourceRevision,
                    localFolderName: manifest.localFolderName,
                    files: manifest.files.map {
                        ParakeetFileEvidence(path: $0.path, bytes: $0.size, sha256: $0.sha256)
                    }
                )
                let data = try JSONEncoder().encode(evidence)
                try data.write(to: options.output, options: [.withoutOverwriting])
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: options.output.path)
                return
            }
            let options = try Options.parse(arguments)
            try requireRegularFile(options.audio, label: "analysis audio")
            try requireDirectory(options.parakeetModel, label: "Parakeet model")
            try requireDirectory(options.diarizationModelRoot, label: "diarization model root")

            RecordFluidAudioOfflinePolicy.enforce()
            try ParakeetModelVerifier.validateV3(at: options.parakeetModel)
            let progress = SpeechProgressReporter()
            progress.report(phase: "loading-transcription-model")
            let transcriber = ParakeetTranscriber(model: .v3)
            try await transcriber.prepare(modelDirectory: options.parakeetModel)
            let transcript = try await transcriber.transcribe(options.audio) { fraction in
                progress.report(phase: "transcription", fraction: fraction)
            }
            await transcriber.release()

            progress.report(phase: "loading-diarization-model")
            let diarizer = OfflineSpeakerDiarizer(maximumSpeakers: options.maximumSpeakers)
            try await diarizer.prepare(modelDirectory: options.diarizationModelRoot)
            let turns = try await diarizer.diarize(options.audio) { completed, total in
                if completed < total {
                    progress.report(phase: "diarization-scan", fraction: Double(completed) / Double(total))
                } else {
                    progress.report(phase: "diarization-finalizing")
                }
            }

            progress.report(phase: "writing-results")
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

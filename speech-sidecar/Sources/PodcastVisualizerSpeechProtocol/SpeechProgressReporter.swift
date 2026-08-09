import Foundation

public let speechProgressSchema = "podcast-visualizer-speech-progress-v1"

private struct SpeechProgress: Codable {
    let schemaVersion: String
    let sequence: Int
    let phase: String
    let fraction: Double?
}

public final class SpeechProgressReporter: @unchecked Sendable {
    private let lock = NSLock()
    private let output: FileHandle
    private var sequence = 0
    private var lastPhase: String?
    private var lastFraction: Double?

    public init(fileDescriptor: Int32) {
        output = FileHandle(fileDescriptor: fileDescriptor, closeOnDealloc: false)
    }

    public func report(phase: String, fraction: Double? = nil) {
        lock.withLock {
            guard fraction?.isFinite != false else { return }
            let bounded = fraction.map { min(1, max(0, $0)) }
            if phase == lastPhase, bounded == lastFraction { return }
            if phase == lastPhase, let bounded, let lastFraction,
               bounded < 1, bounded - lastFraction < 0.001 {
                return
            }
            let nextSequence = sequence + 1
            let value = SpeechProgress(
                schemaVersion: speechProgressSchema,
                sequence: nextSequence,
                phase: phase,
                fraction: bounded
            )
            guard let data = try? JSONEncoder().encode(value),
                  (try? output.write(contentsOf: data + Data([0x0A]))) != nil else {
                return
            }
            sequence = nextSequence
            lastPhase = phase
            lastFraction = bounded
        }
    }
}

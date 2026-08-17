import Foundation

public struct ProgressPresentation: Equatable, Sendable {
    public let phase: String
    public let label: String
    public let fraction: Double?
    public let outputIndex: Int?
    public let totalOutputs: Int?

    public init?(detail: CLIProgressDetail) {
        guard let phase = detail.phase else { return nil }
        self.phase = phase
        self.label = switch phase {
        case "loading-transcription-model": "Loading transcription model"
        case "transcription": "Transcribing audio"
        case "loading-diarization-model": "Loading speaker model"
        case "diarization-scan": "Scanning speaker turns"
        case "diarization-finalizing": "Grouping anonymous speakers"
        case "writing-results": "Saving transcript"
        case "alignment": "Aligning approved transcript"
        case "encoding": "Encoding video"
        case "verifying": "Verifying rendered video"
        case "reused": "Using verified existing output"
        case "downloading-model": "Downloading model"
        case "verifying-model": "Verifying downloaded model"
        case "installing-model": "Installing model"
        default: phase.replacingOccurrences(of: "-", with: " ").capitalized
        }
        fraction = detail.fraction
        outputIndex = detail.outputIndex
        totalOutputs = detail.totalOutputs
    }

    private init(
        phase: String,
        label: String,
        fraction: Double?,
        outputIndex: Int?,
        totalOutputs: Int?
    ) {
        self.phase = phase
        self.label = label
        self.fraction = fraction
        self.outputIndex = outputIndex
        self.totalOutputs = totalOutputs
    }

    public func withOutputPosition(index: Int, total: Int) -> ProgressPresentation {
        ProgressPresentation(
            phase: phase,
            label: label,
            fraction: fraction,
            outputIndex: index,
            totalOutputs: total
        )
    }

    public func estimatedRemainingSeconds(elapsed: TimeInterval) -> TimeInterval? {
        guard let fraction, fraction >= 0.03, fraction < 1, elapsed >= 2 else { return nil }
        return elapsed / fraction * (1 - fraction)
    }
}

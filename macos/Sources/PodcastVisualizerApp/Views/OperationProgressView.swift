import PodcastVisualizerCore
import SwiftUI

struct OperationProgressView: View {
    let store: AppStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let progress = store.progressPresentation {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: 7) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(progress.label)
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(detail(progress, at: context.date))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    if let fraction = progress.fraction {
                        ProgressView(value: fraction, total: 1)
                            .progressViewStyle(.linear)
                            .animation(reduceMotion ? nil : .linear(duration: 0.2), value: fraction)
                            .accessibilityLabel(progress.label)
                            .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
                    } else {
                        ProgressView()
                            .progressViewStyle(.linear)
                            .accessibilityLabel(progress.label)
                            .accessibilityValue("This phase does not expose measurable progress")
                    }
                }
                .padding(12)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 9))
            }
        }
    }

    private func detail(_ progress: ProgressPresentation, at date: Date) -> String {
        var parts: [String] = []
        if let fraction = progress.fraction {
            parts.append("\(Int((fraction * 100).rounded()))%")
        }
        if let index = progress.outputIndex, let total = progress.totalOutputs, total > 1 {
            parts.append("output \(index) of \(total)")
        }
        if let started = store.progressPhaseStartedAt {
            let elapsed = max(0, date.timeIntervalSince(started))
            parts.append("\(clock(elapsed)) elapsed")
            if let remaining = progress.estimatedRemainingSeconds(elapsed: elapsed) {
                parts.append("about \(clock(remaining)) left")
            }
        }
        return parts.joined(separator: " · ")
    }

    private func clock(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval.rounded()))
        let hours = seconds / 3_600
        let minutes = seconds / 60 % 60
        let remainder = seconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
            : String(format: "%d:%02d", minutes, remainder)
    }
}

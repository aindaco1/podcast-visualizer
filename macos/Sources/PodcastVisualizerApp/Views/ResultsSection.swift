import PodcastVisualizerCore
import SwiftUI

struct ResultsSection: View {
    let store: AppStore

    var body: some View {
        SectionCard(title: "Results", systemImage: "checkmark.seal") {
            if store.state.results.isEmpty {
                Text("Verified renders will appear here with codec, dimensions, duration, and size.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.state.results) { result in
                    HStack(alignment: .center, spacing: 14) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(result.aspect) · \(profile(result))")
                                .font(.body.weight(.medium))
                            Text("\(result.width)×\(result.height) · \(duration(result.durationMs)) · \(ByteCountFormatter.string(fromByteCount: result.bytes, countStyle: .file))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Reveal", systemImage: "finder") { store.reveal(result) }
                    }
                    .accessibilityElement(children: .combine)
                    if result.id != store.state.results.last?.id { Divider() }
                }
            }
        }
    }

    private func profile(_ result: RenderResult) -> String {
        if let alpha = result.alphaCodec { return "\(alpha.uppercased()) alpha" }
        return "Opaque H.264"
    }

    private func duration(_ milliseconds: Int) -> String {
        Duration.milliseconds(milliseconds).formatted(.time(pattern: .hourMinuteSecond))
    }
}

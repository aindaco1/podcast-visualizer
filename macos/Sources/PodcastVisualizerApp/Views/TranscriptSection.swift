import SwiftUI

struct TranscriptSection: View {
    let store: AppStore

    var body: some View {
        SectionCard(title: "Transcript", systemImage: "captions.bubble") {
            LabeledContent("Stage") {
                Text(store.state.stage.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                    .monospaced()
            }
            if let analysis = store.state.analysis {
                Text("\(analysis.words.formatted()) words · \(analysis.speakers) anonymous speakers · \(analysis.cues) review cues")
                    .foregroundStyle(.secondary)
            } else {
                Text("Analysis pauses for mandatory local transcript and speaker review before alignment.")
                    .foregroundStyle(.secondary)
            }
            Button("Open Transcript Review") { store.openReview() }
                .disabled(store.state.reviewURL == nil)
                .accessibilityHint("Opens the tokenized loopback review page in your default browser")
        }
    }
}

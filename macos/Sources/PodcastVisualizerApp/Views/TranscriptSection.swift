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
            if store.isAnalyzingSpeech {
                OperationProgressView(store: store)
            }
            if [.sourceSelected, .initialized, .prepared].contains(store.state.stage) {
                Picker("Expected speakers", selection: Bindable(store).expectedSpeakers) {
                    Text("Auto-detect").tag(nil as Int?)
                    ForEach(1...6, id: \.self) { count in
                        Text(count == 1 ? "1 speaker" : "\(count) speakers").tag(count as Int?)
                    }
                }
                .frame(maxWidth: 280)
                .disabled(store.isRunning)
                Text("Choose an exact count when you know it; this helps prevent one person being split into multiple speakers.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Button(store.state.stage == .reviewRequired ? "Open Transcript Review" : "Edit Transcript") {
                store.showTranscriptReview()
            }
                .disabled(![
                    .reviewRequired, .approved, .aligned, .verified, .exported,
                ].contains(store.state.stage) || store.isRunning)
                .accessibilityHint("Opens the native transcript editor in its own app tab")
        }
    }
}

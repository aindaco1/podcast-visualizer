import PodcastVisualizerCore
import SwiftUI

struct TranscriptReviewView: View {
    let appStore: AppStore
    let review: TranscriptReviewStore

    @Environment(\.undoManager) private var undoManager
    @State private var confirmMerge = false
    @State private var confirmApproval = false

    var body: some View {
        Group {
            if appStore.state.stage == .approved || appStore.state.stage == .aligned
                || appStore.state.stage == .verified || appStore.state.stage == .exported {
                completedView
            } else if review.workspace != nil {
                editor
            } else {
                emptyView
            }
        }
        .confirmationDialog(
            "Merge \(review.mergeSource.map(review.displayName) ?? "speaker") into \(review.mergeTarget.map(review.displayName) ?? "speaker")?",
            isPresented: $confirmMerge,
            titleVisibility: .visible
        ) {
            Button("Merge Across Entire Transcript") {
                review.mergeSpeakers(undoManager: undoManager)
            }
        } message: {
            Text("Every cue assigned to the first speaker will be reassigned to the second speaker.")
        }
        .confirmationDialog(
            "Approve this transcript revision?",
            isPresented: $confirmApproval,
            titleVisibility: .visible
        ) {
            Button("Approve Transcript") { appStore.approveTranscriptReview() }
        } message: {
            Text("Approval creates an immutable revision used for alignment and rendering.")
        }
    }

    private var editor: some View {
        NavigationSplitView {
            speakerSidebar
                .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 310)
        } detail: {
            VStack(spacing: 0) {
                editorHeader
                Divider()
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(review.visibleCueIndices, id: \.self) { index in
                            TranscriptCueRow(review: review, index: index, isRunning: appStore.isRunning)
                        }
                    }
                    .padding(18)
                }
                Divider()
                actionBar
            }
        }
    }

    private var speakerSidebar: some View {
        VStack(spacing: 0) {
            List {
                Section("Show") {
                    speakerFilterRow(label: "All Speakers", speaker: nil, count: review.cues.count)
                    ForEach(review.speakers, id: \.self) { speaker in
                        speakerFilterRow(
                            label: review.displayName(speaker),
                            speaker: speaker,
                            count: review.speakerCounts[speaker, default: 0]
                        )
                    }
                    if review.speakerCounts["unknown", default: 0] > 0 {
                        speakerFilterRow(
                            label: "Unknown",
                            speaker: "unknown",
                            count: review.speakerCounts["unknown", default: 0]
                        )
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Text("Speaker names")
                    .font(.headline)
                Picker("Speaker", selection: Bindable(review).renameSpeakerID) {
                    ForEach(review.speakers, id: \.self) { speaker in
                        Text(review.displayName(speaker)).tag(speaker as String?)
                    }
                }
                TextField("Display name", text: Bindable(review).speakerNameDraft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { review.renameSpeaker(undoManager: undoManager) }
                HStack {
                    Button("Rename") { review.renameSpeaker(undoManager: undoManager) }
                        .disabled(!review.canRenameSpeaker || appStore.isRunning)
                    Spacer()
                    Button {
                        review.addSpeaker(undoManager: undoManager)
                    } label: {
                        Label("Add Speaker", systemImage: "plus")
                    }
                    .disabled(!review.canAddSpeaker || appStore.isRunning)
                }
                Text("Display names are saved with the transcript; speaker colors stay unchanged.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Divider()

                Text("Merge speakers")
                    .font(.headline)
                Picker("From", selection: Bindable(review).mergeSource) {
                    ForEach(review.speakers, id: \.self) { speaker in
                        Text(review.displayName(speaker)).tag(speaker as String?)
                    }
                }
                Picker("Into", selection: Bindable(review).mergeTarget) {
                    ForEach(review.speakers, id: \.self) { speaker in
                        Text(review.displayName(speaker)).tag(speaker as String?)
                    }
                }
                Button("Merge Across Transcript") { confirmMerge = true }
                    .disabled(
                        review.mergeSource == nil || review.mergeTarget == nil
                            || review.mergeSource == review.mergeTarget
                            || review.speakerCounts[review.mergeSource ?? "", default: 0] == 0
                    )
                Text("Use this when diarization split one person into multiple labels.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(14)
        }
    }

    private func speakerFilterRow(label: String, speaker: String?, count: Int) -> some View {
        Button {
            review.selectedSpeaker = speaker
        } label: {
            HStack {
                Circle()
                    .fill(speakerColor(speaker))
                    .frame(width: 8, height: 8)
                Text(label)
                Spacer()
                Text(count.formatted()).foregroundStyle(.secondary).monospacedDigit()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(review.selectedSpeaker == speaker ? Color.accentColor.opacity(0.18) : Color.clear)
    }

    private var editorHeader: some View {
        VStack(spacing: 12) {
            ReviewAudioTransport(review: review)
            ReviewFindReplaceBar(review: review, isRunning: appStore.isRunning)
        }
        .padding(16)
        .background(.bar)
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(review.statusMessage)
                if let failure = appStore.state.failure {
                    Text(failure.message).font(.caption).foregroundStyle(.red)
                } else if !review.canApprove {
                    Text("Confirm every non-unknown speaker before approval.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button("Confirm All Assigned") { review.confirmAllAssigned(undoManager: undoManager) }
                .disabled(appStore.isRunning)
            Button("Browser Fallback…") { appStore.openBrowserReviewFallback() }
                .disabled(appStore.isRunning)
            Button("Save") { appStore.saveTranscriptReview() }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(!review.isDirty || appStore.isRunning)
            Button("Approve Transcript") { confirmApproval = true }
                .buttonStyle(.borderedProminent)
                .disabled(!review.canApprove || appStore.isRunning)
        }
        .padding(14)
        .background(.bar)
    }

    private var emptyView: some View {
        ContentUnavailableView {
            Label("Transcript Review", systemImage: "captions.bubble")
        } description: {
            Text("Analyze speech first, then review the transcript here without leaving the app.")
        } actions: {
            if review.isLoading {
                ProgressView("Loading review…")
            } else if appStore.state.stage == .reviewRequired {
                Button("Load Transcript Review") { appStore.showTranscriptReview() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private var completedView: some View {
        ContentUnavailableView {
            Label("Transcript Approved", systemImage: "checkmark.seal.fill")
        } description: {
            Text("The immutable transcript revision is ready for alignment.")
        } actions: {
            Button("Return to Project") { appStore.selectedTab = .project }
                .buttonStyle(.borderedProminent)
        }
    }

    private func speakerColor(_ speaker: String?) -> Color {
        guard let speaker,
              let suffix = speaker.split(separator: "-").last,
              let number = Int(suffix),
              number > 0,
              let palette = appStore.brand?.speakers,
              !palette.isEmpty,
              let token = palette[safe: (number - 1) % palette.count],
              let color = Color(hex: token.bright)
        else { return speaker == "unknown" ? .red : .secondary }
        return color
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private struct ReviewAudioTransport: View {
    let review: TranscriptReviewStore

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Button {
                    review.audioPlayer.togglePlayback()
                } label: {
                    Image(systemName: review.audioPlayer.isPlaying ? "pause.fill" : "play.fill")
                        .frame(width: 18)
                }
                .buttonStyle(.borderedProminent)
                .disabled(review.audioPlayer.duration <= 0)
                Slider(
                    value: Binding(
                        get: { review.audioPlayer.currentTime },
                        set: { review.audioPlayer.seek(to: $0) }
                    ),
                    in: 0...max(0.001, review.audioPlayer.duration)
                )
                Text("\(clock(review.audioPlayer.currentTime)) / \(clock(review.audioPlayer.duration))")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 112, alignment: .trailing)
            }
            if let error = review.audioPlayer.errorMessage {
                Text(error).font(.caption).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func clock(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite else { return "00:00" }
        let total = max(0, Int(seconds.rounded(.down)))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

private struct ReviewFindReplaceBar: View {
    let review: TranscriptReviewStore
    let isRunning: Bool
    @Environment(\.undoManager) private var undoManager

    var body: some View {
        let count = review.replacementPreviewCount
        HStack(spacing: 8) {
            TextField("Find text", text: Bindable(review).findText)
                .textFieldStyle(.roundedBorder)
            Image(systemName: "arrow.right")
                .foregroundStyle(.secondary)
            TextField("Replace with", text: Bindable(review).replacementText)
                .textFieldStyle(.roundedBorder)
            Toggle("Match case", isOn: Bindable(review).caseSensitive)
                .toggleStyle(.checkbox)
            Toggle("Whole words", isOn: Bindable(review).wholeWords)
                .toggleStyle(.checkbox)
            Button(count == 0 ? "Replace All" : "Replace \(count.formatted())") {
                review.replaceAll(undoManager: undoManager)
            }
            .disabled(count == 0 || isRunning)
        }
    }
}

private struct TranscriptCueRow: View {
    let review: TranscriptReviewStore
    let index: Int
    let isRunning: Bool
    @Environment(\.undoManager) private var undoManager

    var cue: ReviewCue { review.cues[index] }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(clock(cue.startsAtMs)) {
                review.audioPlayer.seek(to: Double(cue.startsAtMs) / 1_000, play: true)
            }
            .font(.system(.caption, design: .monospaced))
            .buttonStyle(.borderless)
            .frame(width: 58, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Picker(
                        "Speaker",
                        selection: Binding(
                            get: { cue.speakerLabel },
                            set: { review.setSpeaker($0, at: index) }
                        )
                    ) {
                        ForEach(review.speakers, id: \.self) { speaker in
                            Text(review.displayName(speaker)).tag(speaker)
                        }
                        Text("Unknown").tag("unknown")
                    }
                    .labelsHidden()
                    .frame(width: 150)
                    Toggle(
                        "Confirmed",
                        isOn: Binding(
                            get: { cue.speakerConfirmed },
                            set: { review.setConfirmed($0, at: index) }
                        )
                    )
                    .toggleStyle(.checkbox)
                    .disabled(cue.speakerLabel == "unknown")
                    Spacer()
                    if cue.speakerAmbiguous || cue.speakerLabel == "unknown" {
                        Label("Needs review", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    Button("Merge Next") {
                        review.mergeNextCue(at: index, undoManager: undoManager)
                    }
                    .disabled(index >= review.cues.count - 1 || isRunning)
                    .help("Join this cue with the immediately following cue")
                }
                TextEditor(
                    text: Binding(
                        get: { cue.textMarkdown },
                        set: { review.setText($0, at: index) }
                    )
                )
                .font(.body)
                .frame(minHeight: 52)
                .padding(6)
                .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 7))
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private func clock(_ milliseconds: Int) -> String {
        let total = max(0, milliseconds / 1_000)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

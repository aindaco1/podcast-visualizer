import PodcastVisualizerCore
import SwiftUI

struct TranscriptReviewView: View {
    let appStore: AppStore
    let review: TranscriptReviewStore

    @Environment(\.undoManager) private var undoManager
    @State private var confirmMerge = false
    @State private var confirmDelete = false
    @State private var confirmApproval = false

    var body: some View {
        Group {
            if review.workspace != nil {
                editor
            } else if appStore.state.stage == .approved || appStore.state.stage == .aligned
                || appStore.state.stage == .verified || appStore.state.stage == .exported {
                completedView
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
            "Delete \(review.renameSpeakerID.map(review.displayName) ?? "speaker")?",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete Speaker", role: .destructive) {
                review.deleteSpeaker(undoManager: undoManager)
            }
        } message: {
            let count = review.speakerCounts[review.renameSpeakerID ?? "", default: 0]
            Text(count == 0
                ? "The speaker label will be removed."
                : "\(count.formatted()) transcript cue\(count == 1 ? "" : "s") will be reassigned to Unknown.")
        }
        .confirmationDialog(
            "Approve this transcript revision?",
            isPresented: $confirmApproval,
            titleVisibility: .visible
        ) {
            Button("Approve Transcript") { appStore.approveTranscriptReview() }
        } message: {
            Text("Approval safely reflows same-speaker dialogue and creates an immutable revision. On supported Macs, Apple Intelligence may advise existing boundaries entirely on device; it never rewrites words or assigns speakers.")
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
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(review.visibleCues) { cue in
                                TranscriptCueRow(
                                    review: review,
                                    cueID: cue.id,
                                    isRunning: appStore.isRunning,
                                    selectedMatch: review.currentMatch?.cueID == cue.id
                                        ? review.currentMatch
                                        : nil
                                )
                                .id(cue.id)
                            }
                        }
                        .padding(18)
                    }
                    .onChange(of: review.currentMatch?.id) { _, _ in
                        guard let cueID = review.currentMatch?.cueID else { return }
                        withAnimation(.easeInOut(duration: 0.18)) {
                            proxy.scrollTo(cueID, anchor: .center)
                        }
                    }
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
                    Button("Delete", role: .destructive) { confirmDelete = true }
                        .disabled(!review.canDeleteSpeaker || appStore.isRunning)
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
            Text("The active immutable transcript revision can be edited by creating a new revision.")
        } actions: {
            Button("Edit Transcript") { appStore.showTranscriptReview() }
                .disabled(appStore.isRunning)
                .buttonStyle(.borderedProminent)
            Button("Return to Project") { appStore.selectedTab = .project }
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
    private enum Field: Hashable {
        case find
        case replacement
    }

    let review: TranscriptReviewStore
    let isRunning: Bool
    @Environment(\.undoManager) private var undoManager
    @FocusState private var focusedField: Field?

    var body: some View {
        let count = review.replacementPreviewCount
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                TextField("Find text", text: Bindable(review).findText)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .find)
                    .accessibilityIdentifier("transcript-review-find")
                Image(systemName: "arrow.right")
                    .foregroundStyle(.secondary)
                TextField("Replace with", text: Bindable(review).replacementText)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .replacement)
                    .accessibilityIdentifier("transcript-review-replacement")
                Toggle("Match case", isOn: Bindable(review).caseSensitive)
                    .toggleStyle(.checkbox)
                Toggle("Whole words", isOn: Bindable(review).wholeWords)
                    .toggleStyle(.checkbox)
            }
            HStack(spacing: 8) {
                Text(review.matchPosition)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Search match \(review.matchPosition)")
                Button("Previous") { review.selectPreviousMatch() }
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                    .disabled(count == 0 || isRunning)
                Button("Next") { review.selectNextMatch() }
                    .keyboardShortcut("g", modifiers: .command)
                    .disabled(count == 0 || isRunning)
                Spacer()
                Button("Replace This") {
                    review.replaceCurrent(undoManager: undoManager)
                }
                .disabled(review.currentMatch == nil || isRunning)
                Button(count == 0 ? "Replace All" : "Replace All (\(count.formatted()))") {
                    review.replaceAll(undoManager: undoManager)
                }
                .disabled(count == 0 || isRunning)
            }
        }
    }
}

private struct TranscriptCueRow: View {
    let review: TranscriptReviewStore
    let cueID: ReviewCue.ID
    let isRunning: Bool
    let selectedMatch: ReviewTextMatch?
    @Environment(\.undoManager) private var undoManager
    @State private var textSelection: TextSelection?

    var body: some View {
        if let cue = review.cue(withID: cueID) {
            cueContent(cue)
        }
    }

    private func cueContent(_ cue: ReviewCue) -> some View {
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
                            get: { review.cue(withID: cueID)?.speakerLabel ?? cue.speakerLabel },
                            set: { review.setSpeaker($0, for: cueID) }
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
                            get: { review.cue(withID: cueID)?.speakerConfirmed ?? cue.speakerConfirmed },
                            set: { review.setConfirmed($0, for: cueID) }
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
                        review.mergeNextCue(cueID: cueID, undoManager: undoManager)
                    }
                    .disabled(!review.canMergeNext(cueID: cueID) || isRunning)
                    .help("Join this cue with the immediately following cue")
                }
                TextEditor(
                    text: Binding(
                        get: { review.cue(withID: cueID)?.textMarkdown ?? cue.textMarkdown },
                        set: { review.setText($0, for: cueID) }
                    ),
                    selection: $textSelection
                )
                .font(.body)
                .frame(minHeight: 52)
                .padding(6)
                .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 7))
                .task(id: selectedMatch?.id) {
                    guard let selectedMatch,
                          let range = Range(selectedMatch.utf16Range, in: cue.textMarkdown)
                    else {
                        textSelection = nil
                        return
                    }
                    // Highlight the match without taking the first responder
                    // from the Find or Replace field.
                    textSelection = TextSelection(range: range)
                }
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

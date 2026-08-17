import PodcastVisualizerCore
import SwiftUI

struct MainWindow: View {
    let store: AppStore

    private var background: Color {
        store.brand.flatMap { Color(hex: $0.colors.background) } ?? Color(nsColor: .windowBackgroundColor)
    }

    private var accent: Color {
        store.brand.flatMap { Color(hex: $0.colors.cyan) } ?? .accentColor
    }

    var body: some View {
        TabView(selection: Bindable(store).selectedTab) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    SourceSection(store: store)
                    ModelsSection(store: store)
                    BrandingSection(store: store)
                    TranscriptSection(store: store)
                    OutputsSection(store: store)
                    ResultsSection(store: store)
                    actionBar
                }
                .padding(24)
                .frame(maxWidth: 1080)
                .frame(maxWidth: .infinity)
            }
            .tabItem { Label("Project", systemImage: "waveform") }
            .tag(MainTab.project)

            TranscriptReviewView(appStore: store, review: store.transcriptReview)
                .tabItem { Label("Transcript Review", systemImage: "captions.bubble") }
                .tag(MainTab.transcriptReview)

            ChaptersView(appStore: store, chapters: store.chapterReview)
                .tabItem { Label("Chapters", systemImage: "list.number") }
                .tag(MainTab.chapters)
        }
        .background(background)
        .tint(accent)
        .preferredColorScheme(.dark)
        .task { await store.loadModelsIfNeeded() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { store.checkForUpdates() } label: {
                    Label("Check for Updates", systemImage: "arrow.down.circle")
                }
                .disabled(!store.canCheckForUpdates)
                .help("Check GitHub Releases for a signed Podcast Visualizer update")
                .accessibilityLabel("Check for Updates")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("DUST//WAVE")
                .font(.system(.caption, design: .monospaced, weight: .semibold))
                .foregroundStyle(accent)
            Text("Podcast Visualizer")
                .font(.system(size: 32, weight: .light, design: .rounded))
            Text("Local transcript review and verified video delivery. Media and models stay on this Mac.")
                .foregroundStyle(.secondary)
        }
    }

    private var actionBar: some View {
        HStack {
            if let failure = store.state.failure {
                VStack(alignment: .leading, spacing: 3) {
                    Text(failure.message).foregroundStyle(.red)
                    if let hint = failure.hint { Text(hint).font(.caption).foregroundStyle(.secondary) }
                }
                .accessibilityElement(children: .combine)
            }
            Spacer()
            if store.isRunning {
                ProgressView().controlSize(.small)
                Button("Cancel", role: .cancel) { store.cancel() }
                    .keyboardShortcut(.cancelAction)
            }
            Button(store.nextActionLabel) { store.runNext() }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!store.canRunNext)
        }
        .padding(.vertical, 4)
    }
}

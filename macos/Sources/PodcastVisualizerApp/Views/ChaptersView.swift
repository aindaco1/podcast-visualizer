import PodcastVisualizerCore
import SwiftUI

struct ChaptersView: View {
    let appStore: AppStore
    let chapters: ChapterReviewStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            if let workspace = chapters.workspace {
                controls(workspace)
                if let progress = appStore.chapterAdviceProgress {
                    LocalOperationProgressView(
                        label: progress.label(for: chapters.mode),
                        fraction: progress.fraction,
                        detail: progress.detail,
                        startedAt: appStore.chapterAdviceStartedAt
                    )
                }
                chapterList
                    .disabled(appStore.isRunning)
                footer
            } else {
                ContentUnavailableView {
                    Label("Chapters", systemImage: "list.number")
                } description: {
                    Text("Align an approved transcript, then load exact local timestamps for chapter review.")
                } actions: {
                    Button("Load Chapters") { appStore.showChapters() }
                        .disabled(appStore.isRunning)
                }
            }
        }
        .padding(24)
        .frame(maxWidth: 1_080, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Episode Chapters").font(.title2.weight(.semibold))
                Text("The on-device model suggests titles and chooses only verified alignment anchors. Review and approve every timestamp before export.")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Picker("Style", selection: Binding(
                get: { chapters.mode },
                set: { appStore.changeChapterMode($0) }
            )) {
                Text("Topics").tag(ChapterMode.topics)
                Text("Questions").tag(ChapterMode.questions)
            }
            .pickerStyle(.segmented)
            .frame(width: 220)
            .disabled(appStore.isRunning)
        }
    }

    private func controls(_ workspace: ChapterWorkspace) -> some View {
        HStack {
            Label(
                "\(workspace.contextArtifact.context.windows.count.formatted()) bounded context windows",
                systemImage: "lock.shield"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            Spacer()
            Button("Reload") { appStore.showChapters() }
                .disabled(appStore.isRunning)
            if appStore.isAdvisingChapters {
                Button("Cancel", role: .cancel) { appStore.cancel() }
            } else {
                Button("Generate On Device") { appStore.generateChapterSuggestions() }
                    .buttonStyle(.borderedProminent)
                    .disabled(appStore.isRunning)
            }
        }
    }

    private var chapterList: some View {
        List {
            ForEach(chapters.entries) { entry in
                HStack(spacing: 12) {
                    Menu(chapters.timestamp(for: entry.anchorId)) {
                        ForEach(chapters.records) { record in
                            Button("\(chapters.timestamp(for: record.anchorId))  \(record.text.prefix(64))") {
                                chapters.replaceAnchor(entry.anchorId, with: record)
                            }
                            .disabled(chapters.entries.contains { $0.anchorId == record.anchorId })
                        }
                    }
                    .monospacedDigit()
                    .frame(width: 92, alignment: .leading)

                    TextField("Chapter title", text: Binding(
                        get: {
                            chapters.entries.first(where: { $0.anchorId == entry.anchorId })?.title ?? ""
                        },
                        set: { chapters.updateTitle(anchorId: entry.anchorId, title: $0) }
                    ))

                    Button(role: .destructive) {
                        chapters.remove(anchorId: entry.anchorId)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove chapter at \(chapters.timestamp(for: entry.anchorId))")
                }
                .padding(.vertical, 4)
            }
            Menu {
                ForEach(chapters.unusedRecords) { record in
                    Button("\(chapters.timestamp(for: record.anchorId))  \(record.text.prefix(72))") {
                        chapters.add(record)
                    }
                }
            } label: {
                Label("Add Chapter", systemImage: "plus.circle")
            }
            .disabled(chapters.unusedRecords.isEmpty)
        }
        .frame(minHeight: 320)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(chapters.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Save Draft") { appStore.saveChapters() }
                    .disabled(!chapters.isDirty || appStore.isRunning)
                Button("Approve Chapters") { appStore.approveChapters() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!chapters.canApprove || appStore.isRunning)
            }
            HStack {
                Button("Copy YouTube Chapters") {
                    appStore.exportChapters(format: "youtube", copyToPasteboard: true)
                }
                .disabled(!chapters.hasApproval || chapters.isDirty || appStore.isRunning)
                Button("Export Markdown") {
                    appStore.exportChapters(format: "markdown")
                }
                .disabled(!chapters.hasApproval || chapters.isDirty || appStore.isRunning)
                Button("Export JSON") {
                    appStore.exportChapters(format: "json")
                }
                .disabled(!chapters.hasApproval || chapters.isDirty || appStore.isRunning)
                if let export = chapters.lastExport {
                    Button("Reveal Export") { appStore.revealChapterExport(export) }
                }
            }
        }
    }
}

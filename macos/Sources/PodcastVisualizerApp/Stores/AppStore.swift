import AppKit
import Observation
import PodcastVisualizerCore

enum MainTab: Hashable {
    case project
    case transcriptReview
}

@MainActor
@Observable
final class AppStore {
    private let client: any CLIExecuting
    private let commands: CLICommandBuilder
    private let updateChecker: any UpdateChecking

    var state = AppState()
    var projectSelection: URL?
    var renderSelection = RenderSelection()
    var useFullFile = true
    var clipStartSeconds = 0.0
    var clipEndSeconds = 0.0
    var brand: BrandTokens?
    var selectedTab: MainTab = .project
    var expectedSpeakers: Int?
    let transcriptReview = TranscriptReviewStore()
    private(set) var progressPhaseStartedAt: Date?
    private var completedRenderOutputs = 0
    private var totalRenderOutputs = 0

    init(
        client: any CLIExecuting,
        commands: CLICommandBuilder,
        updateChecker: any UpdateChecking,
        brand: BrandTokens?
    ) {
        self.client = client
        self.commands = commands
        self.updateChecker = updateChecker
        self.brand = brand
    }

    var isRunning: Bool { state.activeCommand != nil }
    var isAnalyzingSpeech: Bool { state.activeCommand == "analyze" }
    var isRenderingVideo: Bool { state.activeCommand == "render" }
    var progressPresentation: ProgressPresentation? {
        guard let progress = state.latestProgress.flatMap({ ProgressPresentation(detail: $0.detail) }) else {
            return nil
        }
        guard isRenderingVideo, totalRenderOutputs > 1 else { return progress }
        return progress.withOutputPosition(
            index: min(totalRenderOutputs, completedRenderOutputs + (progress.outputIndex ?? 1)),
            total: totalRenderOutputs
        )
    }
    var canCheckForUpdates: Bool { updateChecker.canCheckForUpdates }

    var nextActionLabel: String {
        switch state.stage {
        case .empty: "Choose Source"
        case .sourceSelected: "Create Project"
        case .initialized: "Prepare Audio"
        case .prepared: "Analyze Speech"
        case .analyzed: "Continue to Review"
        case .reviewRequired: "Start Transcript Review"
        case .approved: "Align Approved Transcript"
        case .aligned, .verified, .exported: "Render Selected Outputs"
        case .rendering: "Rendering…"
        }
    }

    var canRunNext: Bool {
        guard !isRunning else { return false }
        return switch state.stage {
        case .empty: false
        case .sourceSelected: projectSelection != nil
        case .rendering: false
        default: true
        }
    }

    func chooseSource() {
        if transcriptReview.isDirty {
            let alert = NSAlert()
            alert.messageText = "Save Transcript Edits Before Starting Another Project?"
            alert.informativeText = "Podcast Visualizer will preserve the current working copy before choosing new media."
            alert.addButton(withTitle: "Save and Continue")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            Task {
                if await saveReviewEdits() { chooseSourceFile() }
            }
            return
        }
        chooseSourceFile()
    }

    private func chooseSourceFile() {
        let panel = NSOpenPanel()
        panel.title = "Choose Podcast Audio"
        panel.message = "Select one local audio file or an audio-bearing video."
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await selectSource(url) }
    }

    func openExistingProject() {
        if transcriptReview.isDirty {
            let alert = NSAlert()
            alert.messageText = "Save Transcript Edits Before Opening Another Project?"
            alert.informativeText = "Podcast Visualizer will preserve the current working copy before choosing a different project."
            alert.addButton(withTitle: "Save and Continue")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            Task {
                if await saveReviewEdits() { chooseExistingProjectDirectory() }
            }
            return
        }
        chooseExistingProjectDirectory()
    }

    private func chooseExistingProjectDirectory() {
        let panel = NSOpenPanel()
        panel.title = "Open Podcast Visualizer Project"
        panel.message = "Choose a project directory containing project.json. The project is validated before it opens."
        panel.prompt = "Open Project"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = false
        panel.resolvesAliases = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await openProject(url) }
    }

    func chooseProjectLocation() {
        let panel = NSSavePanel()
        panel.title = "Choose a New Project Directory"
        panel.message = "Podcast Visualizer creates this directory and never replaces an existing project."
        panel.nameFieldStringValue = "Podcast Visualizer Project"
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        projectSelection = url.standardizedFileURL
    }

    func runNext() {
        Task {
            switch state.stage {
            case .sourceSelected: await initializeProject()
            case .initialized: await prepare()
            case .prepared: await analyze()
            case .analyzed:
                try? state.reduce(.reviewRequired)
            case .reviewRequired: await loadTranscriptReview()
            case .approved: await align()
            case .aligned, .verified, .exported: await render()
            default: break
            }
        }
    }

    func cancel() {
        Task {
            await client.cancelCurrentCommand()
            try? state.reduce(.cancelled)
        }
    }

    func openReview() {
        guard let url = state.reviewURL, url.host == "127.0.0.1" else { return }
        NSWorkspace.shared.open(url)
    }

    func showTranscriptReview() {
        Task { await loadTranscriptReview() }
    }

    func saveTranscriptReview() {
        Task { _ = await saveReviewEdits() }
    }

    func approveTranscriptReview() {
        Task { await approveReviewEdits() }
    }

    func openBrowserReviewFallback() {
        Task {
            if transcriptReview.isDirty, !(await saveReviewEdits()) { return }
            transcriptReview.statusMessage = "Starting browser review…"
            await review()
        }
    }

    func reveal(_ result: RenderResult) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: result.outputPath)])
    }

    func checkForUpdates() {
        updateChecker.checkForUpdates()
    }

    private func selectSource(_ url: URL) async {
        let replacedOpenProject = state.projectURL != nil
        await perform(command: { try commands.probe(source: url) }) { data in
            let probe = try ContractDecoder.decode(MediaProbeResult.self, from: data)
            try state.reduce(.sourceSelected(url.standardizedFileURL, probe))
            if replacedOpenProject {
                projectSelection = nil
                transcriptReview.unload()
                selectedTab = .project
            }
            clipStartSeconds = 0
            clipEndSeconds = Double(probe.durationMs) / 1_000
        }
    }

    private func openProject(_ url: URL) async {
        await perform(command: { try commands.status(project: url) }) { data in
            let status = try ContractDecoder.decode(StatusResult.self, from: data)
            try state.reduce(.projectOpened(status))
            projectSelection = state.projectURL
            useFullFile = status.clip.startsAtMs == 0
            clipStartSeconds = Double(status.clip.startsAtMs) / 1_000
            clipEndSeconds = Double(status.clip.endsAtMs) / 1_000
            expectedSpeakers = nil
            transcriptReview.unload()
            selectedTab = .project
        }
    }

    private func initializeProject() async {
        guard let source = state.sourceURL, let project = projectSelection, let probe = state.mediaProbe else { return }
        await perform(command: {
            let clip = useFullFile
                ? try ClipRange.full(durationMs: probe.durationMs)
                : try ClipRange(
                    startsAtMs: Int((clipStartSeconds * 1_000).rounded()),
                    endsAtMs: Int((clipEndSeconds * 1_000).rounded())
                )
            return try commands.initialize(source: source, project: project, clip: clip)
        }) { data in
            let result = try ContractDecoder.decode(InitResult.self, from: data)
            try state.reduce(.projectInitialized(project, result))
        }
    }

    private func prepare() async {
        guard let project = state.projectURL else { return }
        await perform(command: { try commands.prepare(project: project) }) { data in
            try state.reduce(.prepared(ContractDecoder.decode(PrepareResult.self, from: data)))
        }
    }

    private func analyze() async {
        guard let project = state.projectURL else { return }
        await perform(command: {
            try commands.analyze(project: project, expectedSpeakers: expectedSpeakers)
        }) { data in
            try state.reduce(.analyzed(ContractDecoder.decode(AnalyzeResult.self, from: data)))
            try state.reduce(.reviewRequired)
        }
    }

    private func review() async {
        guard let project = state.projectURL else { return }
        await perform(command: { try commands.review(project: project) }) { data in
            try state.reduce(.approved(ContractDecoder.decode(ReviewResult.self, from: data)))
            transcriptReview.markApproved()
            selectedTab = .project
        }
    }

    private func loadTranscriptReview() async {
        guard let project = state.projectURL, state.stage == .reviewRequired else {
            selectedTab = .transcriptReview
            return
        }
        transcriptReview.beginLoading()
        await perform(command: { try commands.loadReview(project: project) }) { data in
            let workspace = try ContractDecoder.decode(ReviewWorkspace.self, from: data)
            transcriptReview.load(workspace)
            selectedTab = .transcriptReview
        }
        if transcriptReview.workspace == nil, state.failure != nil {
            transcriptReview.markLoadFailed()
        }
    }

    private func saveReviewEdits() async -> Bool {
        guard let project = state.projectURL,
              let payload = transcriptReview.editPayload else { return false }
        do {
            let temporary = try makePrivateReviewEdit(payload)
            defer { try? FileManager.default.removeItem(at: temporary.deletingLastPathComponent()) }
            transcriptReview.statusMessage = "Saving working copy…"
            let execution = try await execute(try commands.saveReview(project: project, input: temporary))
            let result = try ContractDecoder.decode(ReviewSaveResult.self, from: execution.standardOutput)
            guard result.ok else {
                throw WorkflowFailure(code: "review_save_failed", message: "The review working copy was not saved.")
            }
            transcriptReview.markSaved()
            try state.reduce(.commandFinished)
            return true
        } catch is CancellationError {
            try? state.reduce(.cancelled)
        } catch {
            transcriptReview.statusMessage = "Save failed"
            record(error)
        }
        return false
    }

    private func approveReviewEdits() async {
        guard let project = state.projectURL,
              let payload = transcriptReview.editPayload else { return }
        do {
            let temporary = try makePrivateReviewEdit(payload)
            defer { try? FileManager.default.removeItem(at: temporary.deletingLastPathComponent()) }
            transcriptReview.statusMessage = "Approving transcript…"
            let execution = try await execute(try commands.approveReview(project: project, input: temporary))
            let approval = try ContractDecoder.decode(
                NativeReviewApprovalResult.self,
                from: execution.standardOutput
            )
            try state.reduce(.nativeReviewApproved(approval))
            transcriptReview.markApproved()
            selectedTab = .project
            try state.reduce(.commandFinished)
        } catch is CancellationError {
            try? state.reduce(.cancelled)
        } catch {
            transcriptReview.statusMessage = "Approval failed"
            record(error)
        }
    }

    private func makePrivateReviewEdit(_ payload: ReviewEditPayload) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-review-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        do {
            let data = try JSONEncoder().encode(payload)
            guard data.count <= 2 * 1024 * 1024 else {
                throw WorkflowFailure(
                    code: "review_too_large",
                    message: "The transcript review working copy exceeds the supported size."
                )
            }
            let file = directory.appendingPathComponent("review-edit.json", isDirectory: false)
            try data.write(to: file, options: .withoutOverwriting)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            return file
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    private func align() async {
        guard let project = state.projectURL else { return }
        await perform(command: { try commands.align(project: project) }) { data in
            try state.reduce(.aligned(ContractDecoder.decode(AlignResult.self, from: data)))
        }
    }

    private func render() async {
        guard let project = state.projectURL else { return }
        do {
            let renderCommands = try commands.render(project: project, selection: renderSelection)
            try state.reduce(.renderStarted)
            var outputs: [RenderResult] = []
            completedRenderOutputs = 0
            totalRenderOutputs = renderSelection.aspects.count * renderSelection.profiles.count
            for command in renderCommands {
                let execution = try await execute(command)
                let commandOutputs = try ContractDecoder.decode([RenderResult].self, from: execution.standardOutput)
                outputs += commandOutputs
                completedRenderOutputs += commandOutputs.count
            }
            try state.reduce(.verified(outputs))
            try state.reduce(.commandFinished)
        } catch is CancellationError {
            try? state.reduce(.cancelled)
        } catch {
            record(error)
        }
    }

    private func perform(
        command: () throws -> CLICommand,
        consume: (Data) throws -> Void
    ) async {
        do {
            let execution = try await execute(command())
            try consume(execution.standardOutput)
            try state.reduce(.commandFinished)
        } catch is CancellationError {
            try? state.reduce(.cancelled)
        } catch {
            record(error)
        }
    }

    private func execute(_ command: CLICommand) async throws -> CLIExecution {
        try state.reduce(.commandStarted(command.label))
        progressPhaseStartedAt = nil
        let result = try await client.run(command) { [weak self] event in
            await self?.receive(event)
        }
        guard result.exitCode == 0 else {
            let response = try ContractDecoder.decode(
                CLIErrorResult.self,
                from: result.standardError,
                maximumBytes: 256 * 1024
            )
            throw WorkflowFailure(
                code: response.error.code,
                message: response.error.message,
                hint: response.error.hint
            )
        }
        return result
    }

    private func receive(_ event: CLIProgressEvent) {
        if let phase = event.detail.phase,
           phase != progressPresentation?.phase || progressPhaseStartedAt == nil {
            progressPhaseStartedAt = Date()
        }
        try? state.reduce(.progress(event))
        if event.event == "review.ready", let rawURL = event.detail.reviewURL,
           let url = URL(string: rawURL), url.host == "127.0.0.1" {
            NSWorkspace.shared.open(url)
        }
    }

    private func record(_ error: Error) {
        let failure = error as? WorkflowFailure
            ?? WorkflowFailure(code: "app_error", message: String(describing: error))
        try? state.reduce(.failed(failure))
    }
}

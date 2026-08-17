import AppKit
import Observation
import PodcastVisualizerCore
import UniformTypeIdentifiers

enum MainTab: Hashable {
    case project
    case transcriptReview
    case chapters
}

private final class SecurityScopedResourceLease {
    let url: URL
    private let hasAccess: Bool

    init(_ url: URL) {
        self.url = url.standardizedFileURL
        hasAccess = self.url.startAccessingSecurityScopedResource()
    }

    deinit {
        if hasAccess { url.stopAccessingSecurityScopedResource() }
    }
}

@MainActor
@Observable
final class AppStore {
    private let client: any CLIExecuting
    private let commands: CLICommandBuilder
    private let updateChecker: any UpdateChecking
    private let modelSources: any ModelSourceProviding
    private let dialogueBoundaryAdviser: any DialogueBoundaryAdvising
    private let chapterAdviser: any ChapterAdvising

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
    let chapterReview = ChapterReviewStore()
    let projectBranding = ProjectBrandingStore()
    let modelLibrary = ModelLibraryStore()
    private(set) var progressPhaseStartedAt: Date?
    private var completedRenderOutputs = 0
    private var totalRenderOutputs = 0
    private var modelDiscoveryCancelled = false
    private var sourceLease: SecurityScopedResourceLease?
    private var logoLease: SecurityScopedResourceLease?
    private var reviewApprovalTask: Task<Void, Never>?
    private var chapterTask: Task<Void, Never>?
    private(set) var isAdvisingTranscript = false
    private(set) var isAdvisingChapters = false

    init(
        client: any CLIExecuting,
        commands: CLICommandBuilder,
        updateChecker: any UpdateChecking,
        brand: BrandTokens?,
        modelSources: (any ModelSourceProviding)? = nil,
        dialogueBoundaryAdviser: (any DialogueBoundaryAdvising)? = nil,
        chapterAdviser: (any ChapterAdvising)? = nil
    ) {
        self.client = client
        self.commands = commands
        self.updateChecker = updateChecker
        self.modelSources = modelSources ?? PersistentModelSourceLibrary()
        self.dialogueBoundaryAdviser = dialogueBoundaryAdviser ?? OnDeviceDialogueBoundaryAdviser()
        self.chapterAdviser = chapterAdviser ?? OnDeviceChapterAdviser()
        self.brand = brand
        modelLibrary.updateSearchLocations(self.modelSources.locations)
    }

    var isRunning: Bool {
        state.activeCommand != nil || isAdvisingTranscript || isAdvisingChapters
    }
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
    var isManagingModels: Bool { state.activeCommand?.hasPrefix("models") == true }

    var nextActionLabel: String {
        switch state.stage {
        case .empty: "Choose Source"
        case .sourceSelected: "Create Project & Continue"
        case .initialized: "Prepare Audio"
        case .prepared:
            modelLibrary.check(for: .parakeet)?.ok == true
                ? "Analyze Speech" : "Set Up Parakeet to Continue"
        case .analyzed: "Continue to Review"
        case .reviewRequired: "Start Transcript Review"
        case .approved:
            modelLibrary.check(for: .alignment)?.ok == true
                ? "Align Approved Transcript" : "Set Up Alignment to Continue"
        case .aligned, .verified, .exported: "Render Selected Outputs"
        case .rendering: "Rendering…"
        }
    }

    var canRunNext: Bool {
        guard !isRunning else { return false }
        return switch state.stage {
        case .empty: false
        case .sourceSelected: projectSelection != nil
        case .prepared: modelLibrary.check(for: .parakeet)?.ok == true
        case .approved: modelLibrary.check(for: .alignment)?.ok == true
        case .rendering: false
        default: true
        }
    }

    func chooseSource() {
        if transcriptReview.isDirty || chapterReview.isDirty {
            let alert = NSAlert()
            alert.messageText = "Save Edits Before Starting Another Project?"
            alert.informativeText = "Podcast Visualizer will preserve transcript and chapter working copies before choosing new media."
            alert.addButton(withTitle: "Save and Continue")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            Task {
                if await saveDirtyProjectEdits() { chooseSourceFile() }
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
        let lease = SecurityScopedResourceLease(url)
        Task { await selectSource(lease.url, lease: lease) }
    }

    func openExistingProject() {
        if transcriptReview.isDirty || chapterReview.isDirty {
            let alert = NSAlert()
            alert.messageText = "Save Edits Before Opening Another Project?"
            alert.informativeText = "Podcast Visualizer will preserve transcript and chapter working copies before choosing a different project."
            alert.addButton(withTitle: "Save and Continue")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            Task {
                if await saveDirtyProjectEdits() { chooseExistingProjectDirectory() }
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
            case .sourceSelected:
                await initializeProject()
                await continueAutomaticWorkflow()
            case .initialized, .prepared, .approved:
                await continueAutomaticWorkflow()
            case .aligned:
                await renderSelectedOutputs()
            case .analyzed:
                try? state.reduce(.reviewRequired)
                await continueAutomaticWorkflow()
            case .reviewRequired:
                await loadTranscriptReview()
            case .verified, .exported:
                await renderSelectedOutputs()
            default: break
            }
        }
    }

    func cancel() {
        reviewApprovalTask?.cancel()
        chapterTask?.cancel()
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

    func showChapters() {
        Task { await loadChapters() }
    }

    func changeChapterMode(_ mode: ChapterMode) {
        guard mode != chapterReview.mode else { return }
        if chapterReview.isDirty {
            let alert = NSAlert()
            alert.messageText = "Save Chapter Draft Before Changing Style?"
            alert.informativeText = "The current chapter draft will be preserved before loading the other style."
            alert.addButton(withTitle: "Save and Continue")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            Task {
                guard await saveChapterEdits() else { return }
                chapterReview.unload()
                chapterReview.mode = mode
                await loadChapters()
            }
            return
        }
        chapterReview.unload()
        chapterReview.mode = mode
        Task { await loadChapters() }
    }

    func generateChapterSuggestions() {
        guard chapterTask == nil else { return }
        if chapterReview.isDirty, !chapterReview.entries.isEmpty {
            let alert = NSAlert()
            alert.messageText = "Replace Unsaved Chapter Suggestions?"
            alert.informativeText = "Generation will replace the current in-memory suggestions. Save the draft first if you want to retain it."
            alert.addButton(withTitle: "Replace Suggestions")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        chapterTask = Task { [weak self] in
            guard let self, let context = self.chapterReview.workspace?.contextArtifact else { return }
            self.isAdvisingChapters = true
            self.chapterReview.statusMessage = "Generating grounded suggestions on this Mac…"
            defer {
                self.isAdvisingChapters = false
                self.chapterTask = nil
            }
            do {
                let advice = try await self.chapterAdviser.advise(context: context)
                try Task.checkCancellation()
                self.chapterReview.applyAdvice(advice)
            } catch is CancellationError {
                self.chapterReview.statusMessage = "Chapter generation cancelled; existing draft preserved"
            } catch {
                self.chapterReview.statusMessage = "Chapter generation failed; existing draft preserved"
            }
        }
    }

    func saveChapters() {
        Task { _ = await saveChapterEdits() }
    }

    func approveChapters() {
        Task { await approveChapterEdits() }
    }

    func exportChapters(format: String, copyToPasteboard: Bool = false) {
        Task { await exportChapterEdits(format: format, copyToPasteboard: copyToPasteboard) }
    }

    func revealChapterExport(_ result: ChapterExportResult) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: result.outputPath)])
    }

    func choosePodcastLogo() {
        let panel = NSOpenPanel()
        panel.title = "Choose Podcast Logo"
        panel.message = "Choose a square PNG. 1024 × 1024 pixels is recommended."
        panel.prompt = "Choose Logo"
        panel.allowedContentTypes = [.png]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let lease = SecurityScopedResourceLease(url)
        if projectBranding.selectLogo(lease.url) { logoLease = lease }
    }

    func removePodcastLogo() {
        logoLease = nil
        projectBranding.removeLogo()
    }

    func saveProjectBranding() {
        Task { _ = await persistProjectBranding() }
    }

    func approveTranscriptReview() {
        guard reviewApprovalTask == nil else { return }
        reviewApprovalTask = Task { [weak self] in
            guard let self else { return }
            await self.approveReviewEdits()
            self.reviewApprovalTask = nil
        }
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

    func loadModelsIfNeeded() async {
        guard !modelLibrary.hasLoadedStatus else { return }
        await refreshModelStatus(automaticallyImport: true)
    }

    func refreshModels() {
        Task { await refreshModelStatus(automaticallyImport: true) }
    }

    func chooseModelSource(_ model: ExternalModel) {
        let panel = NSOpenPanel()
        panel.title = "Locate \(model.title)"
        panel.message = "Choose the \(model.folderName) directory. Its exact pinned files will be verified before they are copied."
        panel.prompt = "Import Model"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = false
        panel.resolvesAliases = false
        panel.directoryURL = modelLibrary.searchLocations.first { $0.kind == .downloads }?.directory
        guard panel.runModal() == .OK, let source = panel.url else { return }
        Task { await importExternalModel(model, from: source) }
    }

    func importExternalModel(_ model: ExternalModel, from source: URL) async {
        guard !isRunning else { return }
        modelLibrary.beginImport(model)
        if await performModelImport(
            model,
            from: source,
            securityScopeRoot: source,
            reportFailure: true
        ) {
            await refreshModelStatus()
        }
    }

    func confirmModelDownload(_ model: ExternalModel) {
        guard !isRunning else { return }
        let alert = NSAlert()
        alert.messageText = "Download \(model.title)?"
        alert.informativeText = "Podcast Visualizer will download \(ByteCountFormatter.string(fromByteCount: model.downloadBytes, countStyle: .file)) from \(model.publisher) under the \(model.license) license. The pinned files are verified before installation. Podcast media and transcripts are never uploaded."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { await downloadExternalModel(model) }
    }

    func addModelSearchLocation() {
        guard !isRunning else { return }
        let panel = NSOpenPanel()
        panel.title = "Add Model Search Location"
        panel.message = "Choose a folder containing parakeet-tdt-0.6b-v3, whisperx-en, or an alignment subfolder. Podcast Visualizer retains read-only access and checks only those exact model paths."
        panel.prompt = "Add Location"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = false
        panel.resolvesAliases = false
        panel.directoryURL = modelLibrary.searchLocations.first { $0.kind == .downloads }?.directory
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        let hasSecurityScope = directory.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScope { directory.stopAccessingSecurityScopedResource() }
        }
        do {
            try modelSources.addUserApprovedDirectory(directory)
            modelLibrary.updateSearchLocations(modelSources.locations)
            Task { await discoverMissingModels() }
        } catch {
            modelLibrary.fail(String(describing: error))
        }
    }

    func removeModelSearchLocation(id: String) {
        guard !isRunning else { return }
        modelSources.removeLocation(id: id)
        modelLibrary.updateSearchLocations(modelSources.locations)
    }

    func downloadExternalModel(_ model: ExternalModel) async {
        guard !isRunning else { return }
        modelLibrary.beginDownload(model)
        do {
            let execution = try await execute(try commands.downloadModel(model.rawValue))
            _ = try ContractDecoder.decode(ModelImportResult.self, from: execution.standardOutput)
            try state.reduce(.commandFinished)
            await refreshModelStatus()
        } catch is CancellationError {
            modelLibrary.fail("Model download cancelled. No partial model was installed.")
            try? state.reduce(.cancelled)
        } catch {
            modelLibrary.fail("Model download failed. The existing installation was not changed.")
            record(error)
        }
    }

    private func refreshModelStatus(automaticallyImport: Bool = false) async {
        guard !isRunning else { return }
        modelLibrary.updateSearchLocations(modelSources.locations)
        modelLibrary.beginRefresh()
        do {
            let execution = try await execute(try commands.modelsStatus())
            modelLibrary.load(try ContractDecoder.decode(
                ModelStatusResult.self,
                from: execution.standardOutput
            ))
            try state.reduce(.commandFinished)
            if automaticallyImport { await discoverMissingModels() }
        } catch is CancellationError {
            modelLibrary.fail("Model check cancelled.")
            try? state.reduce(.cancelled)
        } catch {
            modelLibrary.fail("Unable to verify local models.")
            record(error)
        }
    }

    private func discoverMissingModels() async {
        guard !isRunning, modelLibrary.hasLoadedStatus else { return }
        let missing = ExternalModel.allCases.filter { modelLibrary.check(for: $0)?.ok != true }
        guard !missing.isEmpty else { return }
        modelDiscoveryCancelled = false
        var importedAny = false
        for model in missing where !modelDiscoveryCancelled {
            for location in modelSources.locations where !isRunning && !modelDiscoveryCancelled {
                let outcome = await importDiscoveredModel(model, from: location)
                if outcome == true {
                    importedAny = true
                    break
                }
            }
        }
        if importedAny { await refreshModelStatus() }
    }

    private func importDiscoveredModel(
        _ model: ExternalModel,
        from location: ModelSearchLocation
    ) async -> Bool? {
        let hasSecurityScope = location.requiresSecurityScope
            && location.directory.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScope { location.directory.stopAccessingSecurityScopedResource() }
        }
        var foundCandidate = false
        for source in location.candidates(for: model) where isRealDirectory(source) {
            foundCandidate = true
            modelLibrary.beginDiscovery()
            if await performModelImport(
                model,
                from: source,
                securityScopeRoot: nil,
                reportFailure: false
            ) {
                return true
            }
            if modelDiscoveryCancelled { return false }
        }
        if foundCandidate { modelLibrary.noteDiscoveryFailure(model, at: location) }
        return foundCandidate ? false : nil
    }

    private func performModelImport(
        _ model: ExternalModel,
        from source: URL,
        securityScopeRoot: URL?,
        reportFailure: Bool
    ) async -> Bool {
        let hasSecurityScope = securityScopeRoot?.startAccessingSecurityScopedResource() == true
        defer {
            if hasSecurityScope { securityScopeRoot?.stopAccessingSecurityScopedResource() }
        }
        do {
            let execution = try await execute(try commands.importModel(model.rawValue, source: source))
            _ = try ContractDecoder.decode(ModelImportResult.self, from: execution.standardOutput)
            try state.reduce(.commandFinished)
            return true
        } catch is CancellationError {
            modelDiscoveryCancelled = true
            modelLibrary.fail(reportFailure ? "Model import cancelled." : "Automatic model setup cancelled.")
            try? state.reduce(.cancelled)
            return false
        } catch {
            if reportFailure {
                modelLibrary.fail("Model import failed. The existing installation was not changed.")
                record(error)
            } else {
                try? state.reduce(.commandFinished)
            }
            return false
        }
    }

    private func isRealDirectory(_ url: URL) -> Bool {
        let standardized = url.standardizedFileURL
        guard standardized.isFileURL, standardized.path.hasPrefix("/"),
              standardized.resolvingSymlinksInPath() == standardized,
              let values = try? standardized.resourceValues(
                forKeys: [.isDirectoryKey, .isSymbolicLinkKey]
              ), values.isDirectory == true, values.isSymbolicLink != true else {
            return false
        }
        return true
    }

    private func selectSource(_ url: URL, lease: SecurityScopedResourceLease) async {
        let replacedOpenProject = state.projectURL != nil
        sourceLease = lease
        await perform(command: { try commands.probe(source: url) }) { data in
            let probe = try ContractDecoder.decode(MediaProbeResult.self, from: data)
            try state.reduce(.sourceSelected(url.standardizedFileURL, probe))
            if replacedOpenProject {
                projectSelection = nil
                transcriptReview.unload()
                chapterReview.unload()
                projectBranding.resetForNewProject()
                logoLease = nil
                selectedTab = .project
            }
            clipStartSeconds = 0
            clipEndSeconds = Double(probe.durationMs) / 1_000
        }
        if state.stage != .sourceSelected || state.sourceURL != lease.url {
            if sourceLease === lease { sourceLease = nil }
        }
    }

    private func openProject(_ url: URL) async {
        sourceLease = nil
        logoLease = nil
        await perform(command: { try commands.status(project: url) }) { data in
            let status = try ContractDecoder.decode(StatusResult.self, from: data)
            try state.reduce(.projectOpened(status))
            projectSelection = state.projectURL
            useFullFile = status.clip.startsAtMs == 0
            clipStartSeconds = Double(status.clip.startsAtMs) / 1_000
            clipEndSeconds = Double(status.clip.endsAtMs) / 1_000
            expectedSpeakers = nil
            transcriptReview.unload()
            chapterReview.unload()
            selectedTab = .project
        }
        guard state.projectURL != nil, state.failure == nil else { return }
        await loadProjectBranding()
        guard state.failure == nil else { return }
        await continueAutomaticWorkflow()
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
        if state.stage == .initialized { sourceLease = nil }
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
            finishTranscriptReviewApproval()
        }
        if state.stage == .approved { await continueAutomaticWorkflow() }
    }

    private func loadTranscriptReview() async {
        let editableStages: Set<WorkflowStage> = [
            .reviewRequired, .approved, .aligned, .verified, .exported,
        ]
        guard let project = state.projectURL, editableStages.contains(state.stage) else {
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
              let payload = transcriptReview.editPayload() else { return false }
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
            transcriptReview.statusMessage = "Save cancelled"
            try? state.reduce(.cancelled)
        } catch {
            transcriptReview.statusMessage = "Save failed"
            record(error)
        }
        return false
    }

    private func saveDirtyProjectEdits() async -> Bool {
        if transcriptReview.isDirty, !(await saveReviewEdits()) { return false }
        if chapterReview.isDirty, !(await saveChapterEdits()) { return false }
        return true
    }

    private func loadChapters() async {
        let eligibleStages: Set<WorkflowStage> = [.aligned, .verified, .exported]
        guard let project = state.projectURL, eligibleStages.contains(state.stage) else {
            selectedTab = .chapters
            chapterReview.statusMessage = "Approve and align the transcript before loading chapters"
            return
        }
        chapterReview.beginLoading()
        await perform(command: {
            try commands.loadChapters(project: project, mode: chapterReview.mode)
        }) { data in
            chapterReview.load(try ContractDecoder.decode(
                ChapterWorkspace.self,
                from: data,
                maximumBytes: 4 * 1024 * 1024
            ))
            selectedTab = .chapters
        }
        if chapterReview.workspace == nil, state.failure != nil {
            chapterReview.markLoadFailed()
        }
    }

    private func saveChapterEdits() async -> Bool {
        guard let project = state.projectURL, let payload = chapterReview.editPayload() else {
            return false
        }
        do {
            let temporary = try makePrivateChapterEdit(payload)
            defer { try? FileManager.default.removeItem(at: temporary.deletingLastPathComponent()) }
            chapterReview.statusMessage = "Saving chapter working copy…"
            let execution = try await execute(try commands.saveChapters(
                project: project, input: temporary, mode: chapterReview.mode
            ))
            let result = try ContractDecoder.decode(
                ChapterSaveResult.self,
                from: execution.standardOutput,
                maximumBytes: 256 * 1024
            )
            guard result.entries == payload.entries.count else {
                throw WorkflowFailure(
                    code: "chapter_save_failed",
                    message: "The saved chapter count did not match the current draft.",
                    hint: "The existing chapter draft was preserved. Reload Chapters and try again."
                )
            }
            chapterReview.markSaved()
            try state.reduce(.commandFinished)
            return true
        } catch is CancellationError {
            chapterReview.statusMessage = "Chapter save cancelled; existing draft preserved"
            try? state.reduce(.cancelled)
        } catch {
            chapterReview.statusMessage = "Chapter save failed; existing draft preserved"
            record(error)
        }
        return false
    }

    private func approveChapterEdits() async {
        guard chapterReview.canApprove, let project = state.projectURL,
              let payload = chapterReview.editPayload() else { return }
        do {
            let temporary = try makePrivateChapterEdit(payload)
            defer { try? FileManager.default.removeItem(at: temporary.deletingLastPathComponent()) }
            chapterReview.statusMessage = "Approving exact chapter timestamps…"
            let execution = try await execute(try commands.approveChapters(
                project: project, input: temporary, mode: chapterReview.mode
            ))
            let result = try ContractDecoder.decode(
                ChapterApprovalResult.self,
                from: execution.standardOutput,
                maximumBytes: 256 * 1024
            )
            chapterReview.markApproved(result)
            try state.reduce(.commandFinished)
        } catch is CancellationError {
            chapterReview.statusMessage = "Chapter approval cancelled; draft preserved"
            try? state.reduce(.cancelled)
        } catch {
            chapterReview.statusMessage = "Chapter approval failed; draft preserved"
            record(error)
        }
    }

    private func exportChapterEdits(format: String, copyToPasteboard: Bool) async {
        guard chapterReview.hasApproval, !chapterReview.isDirty,
              let project = state.projectURL else {
            chapterReview.statusMessage = "Approve the current chapter draft before export"
            return
        }
        do {
            let execution = try await execute(try commands.exportChapters(
                project: project, mode: chapterReview.mode, format: format
            ))
            let result = try ContractDecoder.decode(
                ChapterExportResult.self,
                from: execution.standardOutput,
                maximumBytes: 2 * 1024 * 1024
            )
            chapterReview.markExported(result)
            if copyToPasteboard {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(result.content, forType: .string)
                chapterReview.statusMessage = "Copied approved YouTube chapters"
            }
            try state.reduce(.commandFinished)
        } catch is CancellationError {
            chapterReview.statusMessage = "Chapter export cancelled; approval preserved"
            try? state.reduce(.cancelled)
        } catch {
            chapterReview.statusMessage = "Chapter export failed; approval preserved"
            record(error)
        }
    }

    private func makePrivateChapterEdit(_ payload: ChapterEditPayload) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-chapters-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        do {
            let data = try JSONEncoder().encode(payload)
            guard data.count <= 256 * 1024 else {
                throw WorkflowFailure(
                    code: "chapter_edit_too_large",
                    message: "The chapter edit exceeds the supported size.",
                    hint: "The existing chapter draft was preserved. Remove extra entries and try again."
                )
            }
            let file = directory.appendingPathComponent("chapter-edit.json", isDirectory: false)
            try data.write(to: file, options: .withoutOverwriting)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            return file
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    private func approveReviewEdits() async {
        guard let project = state.projectURL,
              let initialPayload = transcriptReview.editPayload() else { return }
        do {
            transcriptReview.statusMessage = "Checking dialogue structure…"
            let advice = try await transcriptBoundaryAdvice(for: initialPayload.cues)
            try Task.checkCancellation()
            guard let payload = transcriptReview.editPayload(
                reflowBoundaryHints: advice.hints
            ) else { return }
            let temporary = try makePrivateReviewEdit(payload)
            defer { try? FileManager.default.removeItem(at: temporary.deletingLastPathComponent()) }
            transcriptReview.statusMessage = advice.usedOnDeviceModel
                ? "Applying on-device dialogue suggestions…"
                : "Applying safe dialogue reflow…"
            let execution = try await execute(try commands.approveReview(project: project, input: temporary))
            let approval = try ContractDecoder.decode(
                NativeReviewApprovalResult.self,
                from: execution.standardOutput
            )
            try state.reduce(.nativeReviewApproved(approval))
            finishTranscriptReviewApproval()
            try state.reduce(.commandFinished)
            await continueAutomaticWorkflow()
        } catch is CancellationError {
            transcriptReview.statusMessage = "Approval cancelled"
            try? state.reduce(.cancelled)
        } catch {
            transcriptReview.statusMessage = "Approval failed"
            record(error)
        }
    }

    func transcriptBoundaryAdvice(
        for cues: [ReviewCue]
    ) async throws -> DialogueBoundaryAdvice {
        isAdvisingTranscript = true
        defer { isAdvisingTranscript = false }
        do {
            return try await dialogueBoundaryAdviser.advise(cues: cues)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return .deterministic
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

    private func finishTranscriptReviewApproval() {
        selectedTab = .project
        transcriptReview.markApproved()
    }

    private func loadProjectBranding() async {
        guard let project = state.projectURL else { return }
        await perform(command: { try commands.loadBranding(project: project) }) { data in
            projectBranding.load(try ContractDecoder.decode(ProjectBrandingWorkspace.self, from: data))
        }
    }

    private func persistProjectBranding() async -> Bool {
        guard let project = state.projectURL,
              let payload = projectBranding.editPayload else { return false }
        do {
            let temporary = try makePrivateBrandingEdit(payload)
            defer { try? FileManager.default.removeItem(at: temporary.deletingLastPathComponent()) }
            projectBranding.statusMessage = "Saving project branding…"
            let execution = try await execute(try commands.saveBranding(project: project, input: temporary))
            let workspace = try ContractDecoder.decode(
                ProjectBrandingWorkspace.self,
                from: execution.standardOutput
            )
            projectBranding.load(workspace)
            logoLease = nil
            projectBranding.statusMessage = "Project branding saved"
            try state.reduce(.commandFinished)
            return true
        } catch is CancellationError {
            try? state.reduce(.cancelled)
        } catch {
            projectBranding.statusMessage = "Branding save failed"
            record(error)
        }
        return false
    }

    private func makePrivateBrandingEdit(_ payload: ProjectBrandingEditPayload) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("podcast-visualizer-branding-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        do {
            let data = try JSONEncoder().encode(payload)
            guard data.count <= 64 * 1024 else {
                throw WorkflowFailure(
                    code: "branding_too_large",
                    message: "The project branding edit exceeds the supported size."
                )
            }
            let file = directory.appendingPathComponent("branding-edit.json", isDirectory: false)
            try data.write(to: file, options: .withoutOverwriting)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            return file
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    private func continueAutomaticWorkflow() async {
        while !isRunning {
            let previous = state.stage
            guard let action = AutomaticWorkflowPolicy.nextAction(for: previous) else { return }
            switch action {
            case .prepare:
                if projectBranding.workspace == nil || projectBranding.isDirty {
                    guard await persistProjectBranding() else { return }
                }
                await prepare()
            case .analyze:
                if !modelLibrary.hasLoadedStatus {
                    await refreshModelStatus(automaticallyImport: true)
                }
                guard modelLibrary.check(for: .parakeet)?.ok == true else { return }
                await analyze()
            case .enterTranscriptReview:
                try? state.reduce(.reviewRequired)
            case .loadTranscriptReview:
                await loadTranscriptReview()
                return
            case .align:
                if !modelLibrary.hasLoadedStatus {
                    await refreshModelStatus(automaticallyImport: true)
                }
                guard modelLibrary.check(for: .alignment)?.ok == true else { return }
                await align()
            }
            guard state.stage != previous else { return }
        }
    }

    private func align() async {
        guard let project = state.projectURL else { return }
        await perform(command: { try commands.align(project: project) }) { data in
            try state.reduce(.aligned(ContractDecoder.decode(AlignResult.self, from: data)))
        }
    }

    private func renderSelectedOutputs() async {
        if projectBranding.isDirty, !(await persistProjectBranding()) { return }
        await render()
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
        try? state.reduce(.failed(Self.workflowFailure(for: error)))
    }

    static func workflowFailure(for error: Error) -> WorkflowFailure {
        if let failure = error as? WorkflowFailure {
            return failure
        }
        if let subprocessError = error as? SubprocessError,
           case .invalidProgress = subprocessError {
            return WorkflowFailure(
                code: "invalid_progress",
                message: "Podcast Visualizer could not read progress from its local helper.",
                hint: "Your source media and all completed project stages were preserved. Reopen the existing project and try again. If the problem recurs, restart Podcast Visualizer."
            )
        }
        return WorkflowFailure(code: "app_error", message: String(describing: error))
    }
}

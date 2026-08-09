import AppKit
import Observation
import PodcastVisualizerCore
import UniformTypeIdentifiers

enum MainTab: Hashable {
    case project
    case transcriptReview
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
    let projectBranding = ProjectBrandingStore()
    let modelLibrary = ModelLibraryStore()
    private(set) var progressPhaseStartedAt: Date?
    private var completedRenderOutputs = 0
    private var totalRenderOutputs = 0
    private var modelDiscoveryCancelled = false
    private var sourceLease: SecurityScopedResourceLease?
    private var logoLease: SecurityScopedResourceLease?

    init(
        client: any CLIExecuting,
        commands: CLICommandBuilder,
        updateChecker: any UpdateChecking,
        brand: BrandTokens?,
        modelSources: (any ModelSourceProviding)? = nil
    ) {
        self.client = client
        self.commands = commands
        self.updateChecker = updateChecker
        self.modelSources = modelSources ?? PersistentModelSourceLibrary()
        self.brand = brand
        modelLibrary.updateSearchLocations(self.modelSources.locations)
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
        let lease = SecurityScopedResourceLease(url)
        Task { await selectSource(lease.url, lease: lease) }
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
            case .sourceSelected:
                await initializeProject()
                await continueAutomaticWorkflow()
            case .initialized, .prepared, .approved, .aligned:
                await continueAutomaticWorkflow()
            case .analyzed:
                try? state.reduce(.reviewRequired)
                await continueAutomaticWorkflow()
            case .reviewRequired:
                await loadTranscriptReview()
            case .verified, .exported:
                await render()
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
            finishTranscriptReviewApproval()
            try state.reduce(.commandFinished)
            await continueAutomaticWorkflow()
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
            case .render:
                if projectBranding.isDirty, !(await persistProjectBranding()) { return }
                await render()
                return
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

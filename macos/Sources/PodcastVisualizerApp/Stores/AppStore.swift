import AppKit
import Observation
import PodcastVisualizerCore

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
        let panel = NSOpenPanel()
        panel.title = "Choose Podcast Audio"
        panel.message = "Select one local audio file or an audio-bearing video."
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await selectSource(url) }
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
            case .reviewRequired: await review()
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

    func reveal(_ result: RenderResult) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: result.outputPath)])
    }

    func checkForUpdates() {
        updateChecker.checkForUpdates()
    }

    private func selectSource(_ url: URL) async {
        await perform(command: { try commands.probe(source: url) }) { data in
            let probe = try ContractDecoder.decode(MediaProbeResult.self, from: data)
            try state.reduce(.sourceSelected(url.standardizedFileURL, probe))
            clipStartSeconds = 0
            clipEndSeconds = Double(probe.durationMs) / 1_000
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
        await perform(command: { try commands.analyze(project: project) }) { data in
            try state.reduce(.analyzed(ContractDecoder.decode(AnalyzeResult.self, from: data)))
            try state.reduce(.reviewRequired)
        }
    }

    private func review() async {
        guard let project = state.projectURL else { return }
        await perform(command: { try commands.review(project: project) }) { data in
            try state.reduce(.approved(ContractDecoder.decode(ReviewResult.self, from: data)))
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
            for command in renderCommands {
                let execution = try await execute(command)
                outputs += try ContractDecoder.decode([RenderResult].self, from: execution.standardOutput)
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
        try? state.reduce(.progress(event))
    }

    private func record(_ error: Error) {
        let failure = error as? WorkflowFailure
            ?? WorkflowFailure(code: "app_error", message: String(describing: error))
        try? state.reduce(.failed(failure))
    }
}

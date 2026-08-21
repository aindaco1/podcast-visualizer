import AppKit
import PodcastVisualizerCore
import SwiftUI

@main
struct PodcastVisualizerApplication: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store: AppStore

    init() {
        let executable = Bundle.main.resourceURL?
            .appendingPathComponent("CLI/bin/dustwave-video", isDirectory: false)
            ?? URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")
        let builder = try! CLICommandBuilder(executable: executable)
        let updater = AppUpdateController()
        let client: any CLIExecuting = FileManager.default.isExecutableFile(atPath: executable.path)
            ? try! SubprocessCLIClient(modelsRoot: AppPaths.modelsRoot())
            : DemoCLIClient()
        let diagnostics: any DiagnosticLogging
        do {
            diagnostics = try DiagnosticLogStore(
                directory: AppPaths.diagnosticsDirectory(),
                application: AppPaths.diagnosticApplicationInfo()
            )
        } catch {
            diagnostics = DisabledDiagnosticLog()
        }
        Task {
            await diagnostics.record(
                .appStarted,
                command: nil,
                stage: WorkflowStage.empty.rawValue,
                failureCode: nil,
                diagnosticCode: nil,
                exitCode: nil,
                durationMs: nil
            )
        }
        _store = State(initialValue: AppStore(
            client: client,
            commands: builder,
            updateChecker: updater,
            brand: BrandLoader.loadFromBundle(),
            diagnostics: diagnostics
        ))
    }

    var body: some Scene {
        WindowGroup("Podcast Visualizer", id: "main") {
            MainWindow(store: store)
                .frame(minWidth: 900, minHeight: 680)
        }
        .defaultSize(width: 1040, height: 780)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Open Project…") { store.openExistingProject() }
                    .keyboardShortcut("o")
                    .disabled(store.isRunning)
                Button("Choose Source…") { store.chooseSource() }
                    .keyboardShortcut("o", modifiers: [.command, .shift])
                    .disabled(store.isRunning)
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

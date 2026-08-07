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
        let updater = DevelopmentUpdateController()
        let client: any CLIExecuting = FileManager.default.isExecutableFile(atPath: executable.path)
            ? try! SubprocessCLIClient(modelsRoot: AppPaths.modelsRoot())
            : DemoCLIClient()
        _store = State(initialValue: AppStore(
            client: client,
            commands: builder,
            updateChecker: updater,
            brand: BrandLoader.loadFromBundle()
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
                Button("Choose Source…") { store.chooseSource() }
                    .keyboardShortcut("o")
                    .disabled(store.isRunning)
            }
            CommandMenu("Podcast Visualizer") {
                Button("Check for Updates…") { store.checkForUpdates() }
                    .disabled(!store.canCheckForUpdates)
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

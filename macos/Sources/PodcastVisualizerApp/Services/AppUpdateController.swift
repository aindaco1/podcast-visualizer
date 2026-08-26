import PodcastVisualizerCore
import Sparkle

/// Owns Sparkle's signed update flow. A silent check runs once when the app
/// launches; presenting and installing an available update remain user driven.
@MainActor
final class AppUpdateController: UpdateChecking {
    let canCheckForUpdates = true
    private let updaterController: SPUStandardUpdaterController

    init(startingUpdater: Bool = true) {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: startingUpdater,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        if startingUpdater && updaterController.updater.automaticallyChecksForUpdates {
            updaterController.updater.checkForUpdatesInBackground()
        }
    }

    func checkForUpdates() {
        updaterController.checkForUpdates(nil)
    }
}

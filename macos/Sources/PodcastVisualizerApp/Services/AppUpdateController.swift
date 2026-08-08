import PodcastVisualizerCore
import Sparkle

/// Owns Sparkle's signed, user-initiated update flow. Automatic checks and
/// automatic installation remain disabled by Info.plist policy.
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
    }

    func checkForUpdates() {
        updaterController.checkForUpdates(nil)
    }
}

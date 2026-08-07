import PodcastVisualizerCore

@MainActor
final class DevelopmentUpdateController: UpdateChecking {
    let canCheckForUpdates = false
    func checkForUpdates() {}
}

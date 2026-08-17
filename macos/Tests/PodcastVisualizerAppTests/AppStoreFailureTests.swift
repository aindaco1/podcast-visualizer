import PodcastVisualizerCore
import Testing
@testable import PodcastVisualizerApp

@Suite("App failure presentation")
struct AppStoreFailureTests {
    @Test("invalid progress explains recovery and preserved data")
    @MainActor
    func invalidProgressRecovery() {
        let failure = AppStore.workflowFailure(for: SubprocessError.invalidProgress)

        #expect(failure.code == "invalid_progress")
        #expect(failure.message == "Podcast Visualizer could not read progress from its local helper.")
        #expect(failure.hint?.contains("preserved") == true)
        #expect(failure.hint?.contains("Reopen the existing project") == true)
        #expect(failure.hint?.contains("restart Podcast Visualizer") == true)
    }
}

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

    @Test("unexpected app errors are private and direct users to diagnostics")
    @MainActor
    func unexpectedFailureRecovery() {
        let failure = AppStore.workflowFailure(for: PrivateFixtureError())

        #expect(failure.code == "app_error")
        #expect(!failure.message.contains("/Users/private"))
        #expect(failure.hint?.contains("preserved") == true)
        #expect(failure.hint?.contains("export a diagnostic log") == true)
    }

    @Test("diagnostic export failures preserve existing data")
    @MainActor
    func diagnosticExportRecovery() {
        let existing = AppStore.diagnosticExportFailure(
            for: DiagnosticLogError.destinationMustBeNew
        )
        #expect(existing.message.contains("did not replace"))
        #expect(existing.hint?.contains("preserved") == true)
        #expect(existing.hint?.contains("new filename") == true)

        let failed = AppStore.diagnosticExportFailure(for: PrivateFixtureError())
        #expect(failed.message.contains("could not export"))
        #expect(failed.hint?.contains("diagnostic history were preserved") == true)
        #expect(!failed.message.contains("/Users/private"))
    }
}

private struct PrivateFixtureError: Error, CustomStringConvertible {
    var description: String { "/Users/private/secret-transcript.json" }
}

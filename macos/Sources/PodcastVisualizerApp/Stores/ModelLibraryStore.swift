import Observation
import PodcastVisualizerCore

enum ExternalModel: String, CaseIterable, Identifiable, Sendable {
    case parakeet = "parakeet-v3"
    case alignment = "align-en"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .parakeet: "Parakeet v3"
        case .alignment: "English alignment"
        }
    }

    var folderName: String {
        switch self {
        case .parakeet: "parakeet-tdt-0.6b-v3"
        case .alignment: "whisperx-en"
        }
    }

    var purpose: String {
        switch self {
        case .parakeet: "Required for local transcription."
        case .alignment: "Required after transcript approval."
        }
    }
}

@MainActor
@Observable
final class ModelLibraryStore {
    private(set) var checks: [ModelCheck] = []
    private(set) var hasLoadedStatus = false
    private(set) var statusMessage = "Checking local models…"

    func check(for model: ExternalModel) -> ModelCheck? {
        checks.first { $0.id == model.rawValue }
    }

    func beginRefresh() {
        statusMessage = "Checking local models…"
    }

    func beginImport(_ model: ExternalModel) {
        statusMessage = "Verifying and importing \(model.title)…"
    }

    func load(_ result: ModelStatusResult) {
        checks = result.checks
        hasLoadedStatus = true
        let missing = ExternalModel.allCases.filter { check(for: $0)?.ok != true }
        statusMessage = missing.isEmpty
            ? "Parakeet and English alignment models are ready."
            : "Locate and import missing models. Verified imports remain available after app updates."
    }

    func fail(_ message: String) {
        hasLoadedStatus = true
        statusMessage = message
    }
}

import Foundation
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

    var downloadBytes: Int64 {
        switch self {
        case .parakeet: 483_104_673
        case .alignment: 377_664_473
        }
    }

    var publisher: String {
        switch self {
        case .parakeet: "FluidInference"
        case .alignment: "PyTorch"
        }
    }

    var license: String {
        switch self {
        case .parakeet: "CC BY 4.0"
        case .alignment: "MIT"
        }
    }

    var sourcePage: URL {
        switch self {
        case .parakeet:
            URL(string: "https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml/tree/aed02740059203c4a87495924f685de3722ae9ce")!
        case .alignment:
            URL(string: "https://docs.pytorch.org/audio/main/generated/torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.html")!
        }
    }
}

@MainActor
@Observable
final class ModelLibraryStore {
    private(set) var checks: [ModelCheck] = []
    private(set) var searchLocations: [ModelSearchLocation] = []
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

    func beginDownload(_ model: ExternalModel) {
        statusMessage = "Downloading \(model.title) from its pinned source…"
    }

    func beginDiscovery() {
        statusMessage = "Checking automatic model locations…"
    }

    func updateSearchLocations(_ locations: [ModelSearchLocation]) {
        searchLocations = locations
    }

    func noteDiscoveryFailure(_ model: ExternalModel, at location: ModelSearchLocation) {
        statusMessage = "A \(model.title) folder in \(location.title) failed verification. Choose another copy or download it."
    }

    func load(_ result: ModelStatusResult) {
        checks = result.checks
        hasLoadedStatus = true
        let missing = ExternalModel.allCases.filter { check(for: $0)?.ok != true }
        statusMessage = missing.isEmpty
            ? "Parakeet and English alignment models are ready."
            : "Missing models can be loaded from the locations below or downloaded securely."
    }

    func fail(_ message: String) {
        hasLoadedStatus = true
        statusMessage = message
    }
}

import Foundation
import PodcastVisualizerCore

enum BrandLoader {
    static func loadFromBundle() -> BrandTokens? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        return try? BrandTokens.load(
            from: resourceURL.appendingPathComponent("brand/dust-wave-v1.json", isDirectory: false)
        )
    }
}

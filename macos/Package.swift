// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PodcastVisualizer",
    platforms: [.macOS("26.0")],
    products: [
        .library(name: "PodcastVisualizerCore", targets: ["PodcastVisualizerCore"]),
        .executable(name: "PodcastVisualizer", targets: ["PodcastVisualizerApp"]),
    ],
    targets: [
        .target(name: "PodcastVisualizerCore"),
        .executableTarget(
            name: "PodcastVisualizerApp",
            dependencies: ["PodcastVisualizerCore"],
            exclude: ["Info.plist"]
        ),
        .testTarget(
            name: "PodcastVisualizerCoreTests",
            dependencies: ["PodcastVisualizerCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)

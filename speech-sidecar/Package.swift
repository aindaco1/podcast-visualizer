// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PodcastVisualizerSpeech",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "podcast-visualizer-speech", targets: ["PodcastVisualizerSpeech"]),
    ],
    dependencies: [
        .package(path: "../shared/dust-wave-platform/native"),
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.15.5"),
    ],
    targets: [
        .target(name: "PodcastVisualizerSpeechProtocol"),
        .executableTarget(
            name: "PodcastVisualizerSpeech",
            dependencies: [
                "PodcastVisualizerSpeechProtocol",
                .product(name: "DustWaveSpeech", package: "native"),
            ]
        ),
        .testTarget(
            name: "PodcastVisualizerSpeechProtocolTests",
            dependencies: ["PodcastVisualizerSpeechProtocol"]
        ),
    ]
)

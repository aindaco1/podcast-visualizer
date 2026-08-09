// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PodcastVisualizerSpeech",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "podcast-visualizer-speech", targets: ["PodcastVisualizerSpeech"]),
    ],
    dependencies: [
        .package(path: "../shared/record"),
    ],
    targets: [
        .target(name: "PodcastVisualizerSpeechProtocol"),
        .executableTarget(
            name: "PodcastVisualizerSpeech",
            dependencies: [
                "PodcastVisualizerSpeechProtocol",
                .product(name: "RecordCore", package: "Record"),
                .product(name: "RecordSpeech", package: "Record"),
            ]
        ),
        .testTarget(
            name: "PodcastVisualizerSpeechProtocolTests",
            dependencies: ["PodcastVisualizerSpeechProtocol"]
        ),
    ]
)

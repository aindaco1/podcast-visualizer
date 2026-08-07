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
        .executableTarget(
            name: "PodcastVisualizerSpeech",
            dependencies: [
                .product(name: "RecordCore", package: "Record"),
                .product(name: "RecordSpeech", package: "Record"),
            ]
        ),
    ]
)

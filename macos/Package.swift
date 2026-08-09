// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PodcastVisualizer",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PodcastVisualizerCore", targets: ["PodcastVisualizerCore"]),
        .executable(name: "PodcastVisualizer", targets: ["PodcastVisualizerApp"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.5"),
    ],
    targets: [
        .target(name: "PodcastVisualizerCore"),
        .executableTarget(
            name: "PodcastVisualizerApp",
            dependencies: [
                "PodcastVisualizerCore",
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            exclude: ["Info.plist"],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-rpath",
                    "-Xlinker", "@executable_path/../Frameworks",
                ])
            ]
        ),
        .testTarget(
            name: "PodcastVisualizerCoreTests",
            dependencies: ["PodcastVisualizerCore"],
            exclude: ["Fixtures"]
        ),
        .testTarget(
            name: "PodcastVisualizerAppTests",
            dependencies: ["PodcastVisualizerApp", "PodcastVisualizerCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)

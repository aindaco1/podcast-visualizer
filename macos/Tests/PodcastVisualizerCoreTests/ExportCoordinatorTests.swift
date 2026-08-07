import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Immutable export coordinator")
struct ExportCoordinatorTests {
    @Test("copies once and refuses collisions")
    func copiesOnce() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let sourceRoot = root.appendingPathComponent("source")
        let destination = root.appendingPathComponent("destination")
        try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let source = sourceRoot.appendingPathComponent("episode.mov")
        try Data("verified output".utf8).write(to: source)
        let coordinator = ExportCoordinator()

        let copied = try coordinator.copyVerifiedOutput(from: source, to: destination)
        #expect(try Data(contentsOf: copied) == Data("verified output".utf8))
        #expect(throws: ExportError.destinationExists) {
            try coordinator.copyVerifiedOutput(from: source, to: destination)
        }
    }

    @Test("rejects traversal names and symlinks")
    func rejectsUnsafePaths() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("destination")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("episode.mov")
        try Data("verified output".utf8).write(to: source)
        let link = root.appendingPathComponent("linked.mov")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
        let coordinator = ExportCoordinator()

        #expect(throws: ExportError.unsafeFileName) {
            try coordinator.copyVerifiedOutput(from: source, to: destination, fileName: "../escape.mov")
        }
        #expect(throws: ExportError.unsafeSource) {
            try coordinator.copyVerifiedOutput(from: link, to: destination)
        }
    }
}

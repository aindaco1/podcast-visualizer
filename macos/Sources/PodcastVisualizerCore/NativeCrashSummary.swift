import Darwin
import Foundation

/// Reads only this app's bounded macOS incident files. Raw incidents never enter
/// diagnostic storage, the review sheet, or the network submission payload.
public struct NativeCrashSummary: Codable, Equatable, Sendable {
    public static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports", isDirectory: true)
    }
    public let exception: String
    public let signal: String?
    public let image: String?
    public let imageOffset: Int?

    public static let exceptions: Set<String> = ["EXC_BAD_ACCESS", "EXC_BAD_INSTRUCTION", "EXC_ARITHMETIC", "EXC_EMULATION", "EXC_SOFTWARE", "EXC_BREAKPOINT", "EXC_CRASH", "EXC_RESOURCE", "EXC_GUARD"]
    public static let images: Set<String> = ["PodcastVisualizer", "SwiftUI", "SwiftUICore", "AppKit", "libswiftCore.dylib", "libsystem_kernel.dylib"]
    public var isValid: Bool {
        Self.exceptions.contains(exception) && (signal.map(FailureDetails.signals.contains) ?? true)
            && (image.map(Self.images.contains) ?? true)
            && (imageOffset.map { (0...1_000_000_000).contains($0) } ?? true)
    }

    public static func parse(_ data: Data) -> DiagnosticSubmission? {
        guard data.count <= 2 * 1024 * 1024, let newline = data.firstIndex(of: 10),
              let header = try? JSONSerialization.jsonObject(with: data[..<newline]) as? [String: Any],
              header["bundleID"] as? String == "com.aindaco.podcast-visualizer",
              let id = header["incident_id"] as? String, UUID(uuidString: id) != nil,
              let body = try? JSONSerialization.jsonObject(with: data[data.index(after: newline)...]) as? [String: Any],
              ["PodcastVisualizer", "Podcast Visualizer"].contains(body["procName"] as? String ?? ""),
              let exception = body["exception"] as? [String: Any],
              let type = exception["type"] as? String, exceptions.contains(type) else { return nil }
        let signal = (exception["signal"] as? String).flatMap { FailureDetails.signals.contains($0) ? $0 : nil }
        var image: String?
        var offset: Int?
        if let threads = body["threads"] as? [[String: Any]],
           let faulting = body["faultingThread"] as? Int, threads.indices.contains(faulting),
           let frames = threads[faulting]["frames"] as? [[String: Any]],
           let used = body["usedImages"] as? [[String: Any]] {
            for frame in frames.prefix(12) {
                guard let index = frame["imageIndex"] as? Int, used.indices.contains(index),
                      let name = used[index]["name"] as? String, images.contains(name),
                      let candidate = frame["imageOffset"] as? Int, (0...1_000_000_000).contains(candidate) else { continue }
                image = name
                offset = candidate
                break
            }
        }
        let summary = Self(exception: type, signal: signal, image: image, imageOffset: offset)
        let train = (body["osVersion"] as? [String: Any])?["train"] as? String ?? ""
        let osVersion = train.range(of: "^macOS [0-9]{1,3}(\\.[0-9]{1,3}){1,2}$", options: .regularExpression) != nil
            ? String(train.dropFirst(6)) : "unknown"
        return DiagnosticSubmission(crash: summary, id: id.lowercased(), application: DiagnosticApplicationInfo(
            version: header["app_version"] as? String ?? "unknown",
            build: header["build_version"] as? String ?? "unknown",
            operatingSystem: osVersion, architecture: body["cpuType"] as? String == "ARM-64" ? "arm64"
                : body["cpuType"] as? String == "X86-64" ? "x86_64" : "unknown"))
    }

    public static func recentReports(directory: URL, now: Date = Date()) throws -> [DiagnosticSubmission] {
        let directory = directory.standardizedFileURL
        guard directory.resolvingSymlinksInPath() == directory else { return [] }
        let files = try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
            .filter { $0.pathExtension == "ips" && ($0.lastPathComponent.hasPrefix("PodcastVisualizer-")
                || $0.lastPathComponent.hasPrefix("Podcast Visualizer-")) }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }.prefix(20)
        return files.compactMap { url in
            let descriptor = url.path.withCString { Darwin.open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK) }
            guard descriptor >= 0 else { return nil }
            let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
            defer { try? handle.close() }
            var status = stat()
            guard fstat(descriptor, &status) == 0, (status.st_mode & S_IFMT) == S_IFREG,
                  (1...2 * 1024 * 1024).contains(status.st_size),
                  abs(now.timeIntervalSince1970 - Double(status.st_mtimespec.tv_sec)) < 14 * 24 * 3600,
                  let data = try? handle.read(upToCount: 2 * 1024 * 1024 + 1) else { return nil }
            return parse(data)
        }.prefix(5).map { $0 }
    }
}

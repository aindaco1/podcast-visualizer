import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("Reviewed diagnostic submission")
struct DiagnosticSubmissionTests {
    static func crashData(id: String = UUID().uuidString) throws -> Data {
        let header: [String: Any] = ["bundleID": "com.aindaco.podcast-visualizer", "incident_id": id,
            "app_version": "1.3.0", "build_version": "23", "name": "/Users/private/Secret-name"]
        let body: [String: Any] = ["procName": "PodcastVisualizer", "procPath": "/Users/private/Secret-app",
            "cpuType": "ARM-64", "exception": ["type": "EXC_BREAKPOINT", "signal": "SIGTRAP", "rawCodes": "Secret"],
            "faultingThread": 0, "threads": [["frames": [["imageIndex": 0, "imageOffset": 1234, "symbol": "Secret"]]]],
            "usedImages": [["name": "libswiftCore.dylib", "path": "/Users/private/Secret-image"]]]
        return try JSONSerialization.data(withJSONObject: header) + Data([10]) + JSONSerialization.data(withJSONObject: body)
    }

    @Test("macOS incident extraction excludes paths, messages, symbols, and arbitrary fields")
    func nativeCrashPrivacy() throws {
        let data = try Self.crashData()
        let report = try #require(NativeCrashSummary.parse(data))
        #expect(report.isValid)
        #expect(report.kind == "native_crash")
        #expect(report.crash?.exception == "EXC_BREAKPOINT")
        #expect(report.crash?.signal == "SIGTRAP")
        #expect(report.crash?.imageOffset == 1234)
        let encoded = try JSONEncoder().encode(report)
        #expect(!String(decoding: encoded, as: UTF8.self).contains("Secret"))
        #expect(NativeCrashSummary.parse(Data(repeating: 65, count: 2 * 1024 * 1024 + 1)) == nil)
        #expect(NativeCrashSummary.parse(Data(String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "com.aindaco.podcast-visualizer", with: "com.other.app").utf8)) == nil)
        #expect(NativeCrashSummary.parse(try Self.crashData(id: "not-an-incident-id")) == nil)
    }

    @Test("native incident scan rejects symlinks and unrelated files")
    func nativeCrashFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("other.ips")
        try Self.crashData().write(to: source)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("PodcastVisualizer-symlink.ips"), withDestinationURL: source)
        #expect(try NativeCrashSummary.recentReports(directory: root).isEmpty)
        try Self.crashData().write(to: root.appendingPathComponent("PodcastVisualizer-2026-09-07.ips"))
        #expect(try NativeCrashSummary.recentReports(directory: root).count == 1)
    }

    @Test("disabled builds never contact transport and successful receipts must match the report")
    func submissionTransport() async throws {
        let report = try #require(NativeCrashSummary.parse(try Self.crashData()))
        let spy = SubmissionTransportSpy()
        let disabled = DiagnosticSubmissionClient(enabled: false, transport: { try await spy.send($0) })
        await #expect(throws: DiagnosticSubmissionError.disabled) { try await disabled.submit(report) }
        #expect(await spy.requests.isEmpty)
        let enabled = DiagnosticSubmissionClient(enabled: true, transport: { try await spy.send($0) })
        #expect(try await enabled.submit(report) == 42)
        let request = try #require(await spy.requests.first)
        #expect(request.url == DiagnosticSubmissionClient.endpoint)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(!String(decoding: request.httpBody!, as: UTF8.self).contains("Secret"))
        for action in ["limited", "ignored", "unknown"] {
            let client = DiagnosticSubmissionClient(enabled: true) { request in
                (Data("{\"ok\":true,\"reportId\":\"\(report.id)\",\"action\":\"\(action)\",\"issueNumber\":42}".utf8),
                 HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            await #expect(throws: DiagnosticSubmissionError.rejected) { try await client.submit(report) }
        }
        let limited = DiagnosticSubmissionClient(enabled: true) { request in
            (Data(), HTTPURLResponse(url: request.url!, statusCode: 429, httpVersion: nil, headerFields: nil)!)
        }
        await #expect(throws: DiagnosticSubmissionError.rateLimited) { try await limited.submit(report) }
    }

    @Test("report projection distinguishes interrupted renders and excludes current work and cancellations")
    func interruptedRender() throws {
        let id = UUID().uuidString.lowercased()
        func event(_ kind: String, session: String = "previous", code: String? = nil) throws -> DiagnosticEvent {
            var value: [String: Any] = ["schemaVersion": DiagnosticEvent.schema, "timestamp": "2026-09-07T01:00:00.000Z",
                "sessionID": session, "kind": kind, "command": "render", "stage": "rendering",
                "context": ["attemptID": id, "renderProgress": ["phase": "encoding", "fraction": 0.25]],
                "application": ["version": "1.3.0", "build": "23", "operatingSystem": "Version 26.6.2 (Build 25G55)", "architecture": "arm64"]]
            if let code { value["failureCode"] = code }
            return try JSONDecoder().decode(DiagnosticEvent.self, from: JSONSerialization.data(withJSONObject: value))
        }
        let checkpoint = try event("render_checkpoint")
        let interrupted = try #require(DiagnosticSubmission.fromEvents([checkpoint], currentSessionID: "current").first)
        #expect(interrupted.isValid)
        #expect(interrupted.kind == "interrupted_render")
        #expect(interrupted.application.operatingSystem == "26.6.2")
        #expect(DiagnosticSubmission.fromEvents([checkpoint], currentSessionID: "previous").isEmpty)
        #expect(try DiagnosticSubmission.fromEvents([checkpoint, event("command_failed", code: "cancelled")], currentSessionID: "current").isEmpty)
        #expect(try DiagnosticSubmission.fromEvents([checkpoint, event("command_completed")], currentSessionID: "current").isEmpty)
    }
}

private actor SubmissionTransportSpy {
    private(set) var requests: [URLRequest] = []
    func send(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let report = try JSONDecoder().decode(DiagnosticSubmission.self, from: request.httpBody!)
        let data = Data("{\"ok\":true,\"reportId\":\"\(report.id)\",\"action\":\"created\",\"issueNumber\":42}".utf8)
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

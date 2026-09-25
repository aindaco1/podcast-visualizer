import DustWaveDiagnostics
import Foundation

/// A separate, strict public projection. Never upload an exported local log.
public struct DiagnosticSubmission: Codable, Equatable, Sendable, Identifiable {
    public static let schema = "podcast-visualizer-issue-report-v1"
    public let schemaVersion: String
    public let id: String
    public let application: DiagnosticApplicationInfo
    public let kind: String
    public let command: String?
    public let failureCode: String
    public let diagnosticCode: String?
    public let exitCode: Int32?
    public let durationMs: Int?
    public let renderSettings: RenderInvocation?
    public let context: DiagnosticContext?
    public let crash: NativeCrashSummary?

    public static let failureCodes: Set<String> = ["failure", "render_failure", "app_error", "helper_failed", "invalid_progress", "interrupted_render"]
    public static let diagnosticCodes = Set(["runtime", "alignment", "branding", "scene", "staging", "encoding", "verification", "output"].map { "render_\($0)_failed" })
    public static let commands: Set<String> = ["probe", "init", "status", "prepare", "analyze", "review", "align", "render", "export", "doctor", "models", "chapters", "branding"]

    public init?(event: DiagnosticEvent, interrupted: Bool = false) {
        guard let context = event.context, context.isValid,
              event.command == "render" || !interrupted,
              interrupted || Self.failureCodes.contains(event.failureCode ?? "") else { return nil }
        schemaVersion = Self.schema
        id = context.attemptID
        // Values from imported local history must not become arbitrary public text.
        application = DiagnosticApplicationInfo(
            version: Self.numericVersion(event.application.version),
            build: Self.numericVersion(event.application.build),
            operatingSystem: Self.osVersion(event.application.operatingSystem),
            architecture: ["arm64", "x86_64"].contains(event.application.architecture) ? event.application.architecture : "unknown")
        kind = interrupted ? "interrupted_render" : "workflow_failure"
        command = event.command?.split(separator: " ").first.map(String.init).flatMap { Self.commands.contains($0) ? $0 : nil }
        failureCode = interrupted ? "interrupted_render" : event.failureCode!
        diagnosticCode = event.diagnosticCode.flatMap { Self.diagnosticCodes.contains($0) ? $0 : nil }
        exitCode = interrupted ? nil : event.exitCode
        durationMs = event.durationMs
        renderSettings = event.renderSettings
        self.context = context
        crash = nil
    }

    init(crash: NativeCrashSummary, id: String, application: DiagnosticApplicationInfo) {
        schemaVersion = Self.schema
        self.id = id
        self.application = DiagnosticApplicationInfo(version: Self.numericVersion(application.version),
            build: Self.numericVersion(application.build), operatingSystem: Self.osVersion(application.operatingSystem),
            architecture: application.architecture)
        kind = "native_crash"
        command = nil
        failureCode = "native_crash"
        diagnosticCode = nil
        exitCode = nil
        durationMs = nil
        renderSettings = nil
        context = nil
        self.crash = crash
    }

    public var isValid: Bool {
        schemaVersion == Self.schema && UUID(uuidString: id)?.uuidString.lowercased() == id
            && [application.version, application.build, application.operatingSystem].allSatisfy { $0 == "unknown" || Self.numericVersion($0) == $0 }
            && ["arm64", "x86_64", "unknown"].contains(application.architecture)
            && ["workflow_failure", "interrupted_render", "native_crash"].contains(kind)
            && (command.map(Self.commands.contains) ?? true)
            && (Self.failureCodes.contains(failureCode) || failureCode == "native_crash")
            && (diagnosticCode.map(Self.diagnosticCodes.contains) ?? true)
            && (exitCode.map { (0...255).contains($0) } ?? true)
            && (durationMs.map { (0...604_800_000).contains($0) } ?? true)
            && (renderSettings?.isValid ?? true) && (context?.isValid ?? true) && (crash?.isValid ?? true)
            && (kind == "native_crash" ? crash != nil && context == nil : crash == nil && context?.attemptID == id)
    }

    private static func numericVersion(_ value: String) -> String {
        value.range(of: "^[0-9]{1,8}(\\.[0-9]{1,8}){0,3}$", options: .regularExpression) != nil ? value : "unknown"
    }

    private static func osVersion(_ value: String) -> String {
        if numericVersion(value) != "unknown" { return value }
        guard let range = value.range(of: "^Version [0-9]{1,3}(\\.[0-9]{1,3}){1,2} \\(Build [A-Za-z0-9]{1,12}\\)$", options: .regularExpression) else { return "unknown" }
        return String(value[range]).split(separator: " ").dropFirst().first.map(String.init) ?? "unknown"
    }

    public static func fromEvents(_ events: [DiagnosticEvent], currentSessionID: String) -> [Self] {
        var lastByAttempt: [String: DiagnosticEvent] = [:]
        var order: [String] = []
        for event in events where event.context?.isValid == true {
            let id = event.context!.attemptID
            if lastByAttempt[id] == nil { order.append(id) }
            lastByAttempt[id] = event
        }
        return order.compactMap { id in
            guard let event = lastByAttempt[id] else { return nil }
            if event.kind == .commandFailed { return Self(event: event) }
            if event.sessionID != currentSessionID, event.command == "render",
               [.commandStarted, .renderCheckpoint].contains(event.kind) {
                // Absence of a terminal record indicates interruption, not proof of a crash.
                return Self(event: event, interrupted: true)
            }
            return nil
        }.suffix(20).map { $0 }
    }
}

public enum DiagnosticSubmissionError: Error, Equatable, Sendable {
    case disabled
    case invalidPayload
    case unavailable
    case rateLimited
    case rejected
}

public protocol DiagnosticSubmitting: Sendable {
    var enabled: Bool { get }
    func submit(_ report: DiagnosticSubmission) async throws -> Int
}

public struct DiagnosticSubmissionClient: DiagnosticSubmitting {
    public let enabled: Bool
    public static let endpoint = URL(string: "https://crash.dustwave.xyz/v1/podcast-visualizer/reports")!
    private let transport: @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    public init(enabled: Bool, transport: @escaping @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse) = Self.send) {
        self.enabled = enabled
        self.transport = transport
    }

    public func submit(_ report: DiagnosticSubmission) async throws -> Int {
        guard enabled else { throw DiagnosticSubmissionError.disabled }
        let data = try JSONEncoder().encode(report)
        guard report.isValid, data.count <= 8_192 else { throw DiagnosticSubmissionError.invalidPayload }
        var request = URLRequest(url: Self.endpoint, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Podcast-Visualizer-Support/1", forHTTPHeaderField: "User-Agent")
        let response: (Data, HTTPURLResponse)
        do { response = try await transport(request) }
        catch { throw DiagnosticSubmissionError.unavailable }
        if response.1.statusCode == 429 { throw DiagnosticSubmissionError.rateLimited }
        guard response.1.statusCode == 200,
              let receipt = try? ReportAcknowledgement.decode(response.0, reportID: report.id,
                maximumBytes: 4096, actions: ["created", "updated", "aggregated", "duplicate"],
                maximumIssueNumber: .max) else { throw DiagnosticSubmissionError.rejected }
        return receipt.issueNumber
    }

    public static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 15
        do {
            return try await BoundedReportTransport().send(request,
                maximumResponseBytes: 4096, configuration: configuration)
        } catch ReportTransportError.responseTooLarge { throw DiagnosticSubmissionError.rejected }
        catch ReportTransportError.invalidResponse { throw DiagnosticSubmissionError.unavailable }
    }
}

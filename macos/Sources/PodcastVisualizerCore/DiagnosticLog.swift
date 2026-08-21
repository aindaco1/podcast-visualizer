import Darwin
import Foundation

public struct DiagnosticApplicationInfo: Codable, Equatable, Sendable {
    public let version: String
    public let build: String
    public let operatingSystem: String
    public let architecture: String

    public init(version: String, build: String, operatingSystem: String, architecture: String) {
        self.version = Self.bounded(version, fallback: "unknown")
        self.build = Self.bounded(build, fallback: "unknown")
        self.operatingSystem = Self.bounded(operatingSystem, fallback: "unknown")
        self.architecture = Self.bounded(architecture, fallback: "unknown")
    }

    private static func bounded(_ value: String, fallback: String) -> String {
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty, candidate.utf8.count <= 120,
              candidate.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            return fallback
        }
        return candidate
    }
}

public enum DiagnosticEventKind: String, Codable, Sendable {
    case appStarted = "app_started"
    case commandStarted = "command_started"
    case commandCompleted = "command_completed"
    case commandFailed = "command_failed"
    case supportExportRequested = "support_export_requested"
}

public struct DiagnosticEvent: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-diagnostic-event-v1"

    public let schemaVersion: String
    public let timestamp: String
    public let sessionID: String
    public let application: DiagnosticApplicationInfo
    public let kind: DiagnosticEventKind
    public let command: String?
    public let stage: String?
    public let failureCode: String?
    public let diagnosticCode: String?
    public let exitCode: Int32?
    public let durationMs: Int?

    fileprivate init(
        timestamp: String,
        sessionID: String,
        application: DiagnosticApplicationInfo,
        kind: DiagnosticEventKind,
        command: String? = nil,
        stage: String? = nil,
        failureCode: String? = nil,
        diagnosticCode: String? = nil,
        exitCode: Int32? = nil,
        durationMs: Int? = nil
    ) {
        schemaVersion = Self.schema
        self.timestamp = timestamp
        self.sessionID = sessionID
        self.application = application
        self.kind = kind
        self.command = command
        self.stage = stage
        self.failureCode = failureCode
        self.diagnosticCode = diagnosticCode
        self.exitCode = exitCode
        self.durationMs = durationMs
    }
}

public struct DiagnosticSupportReport: Codable, Equatable, Sendable {
    public static let schema = "podcast-visualizer-support-report-v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let privacyNotice: String
    public let excludedData: [String]
    public let droppedEventCount: Int
    public let skippedInvalidRecordCount: Int
    public let events: [DiagnosticEvent]
}

public struct DiagnosticExportSummary: Equatable, Sendable {
    public let destination: URL
    public let eventCount: Int
    public let droppedEventCount: Int
    public let skippedInvalidRecordCount: Int
}

public enum DiagnosticLogError: Error, Equatable, Sendable {
    case unsafeDirectory
    case unsafeLogFile
    case destinationMustBeNew
    case diagnosticsUnavailable
    case writeFailed(Int32)
}

public protocol DiagnosticLogging: Sendable {
    func record(
        _ kind: DiagnosticEventKind,
        command: String?,
        stage: String?,
        failureCode: String?,
        diagnosticCode: String?,
        exitCode: Int32?,
        durationMs: Int?
    ) async

    func export(to destination: URL) async throws -> DiagnosticExportSummary
}

public actor DisabledDiagnosticLog: DiagnosticLogging {
    public init() {}

    public func record(
        _ kind: DiagnosticEventKind,
        command: String?,
        stage: String?,
        failureCode: String?,
        diagnosticCode: String?,
        exitCode: Int32?,
        durationMs: Int?
    ) {}

    public func export(to destination: URL) throws -> DiagnosticExportSummary {
        throw DiagnosticLogError.diagnosticsUnavailable
    }
}

public actor DiagnosticLogStore: DiagnosticLogging {
    public static let defaultMaximumLogBytes = 1024 * 1024
    public static let maximumExportedEvents = 5_000

    private static let activeFilename = "events.jsonl"
    private static let previousFilename = "events.previous.jsonl"
    private static let excludedData = [
        "source media",
        "file paths and command arguments",
        "transcript text",
        "model inputs and outputs",
        "review data",
        "rendered outputs",
        "raw standard output and standard error",
    ]

    private let directory: URL
    private let activeLog: URL
    private let previousLog: URL
    private let application: DiagnosticApplicationInfo
    private let sessionID: String
    private let maximumLogBytes: Int
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var droppedEventCount = 0

    public init(
        directory: URL,
        application: DiagnosticApplicationInfo,
        sessionID: String = UUID().uuidString.lowercased(),
        maximumLogBytes: Int = DiagnosticLogStore.defaultMaximumLogBytes
    ) throws {
        let standardized = directory.standardizedFileURL
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL
        guard directory.isFileURL, standardized.path.hasPrefix("/"),
              standardized != URL(fileURLWithPath: "/", isDirectory: true),
              standardized != home,
              maximumLogBytes >= 1_024,
              Self.isIdentifier(sessionID, maximumBytes: 64) else {
            throw DiagnosticLogError.unsafeDirectory
        }
        self.directory = standardized
        activeLog = standardized.appendingPathComponent(Self.activeFilename, isDirectory: false)
        previousLog = standardized.appendingPathComponent(Self.previousFilename, isDirectory: false)
        self.application = application
        self.sessionID = sessionID
        self.maximumLogBytes = maximumLogBytes
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    public func record(
        _ kind: DiagnosticEventKind,
        command: String?,
        stage: String?,
        failureCode: String?,
        diagnosticCode: String?,
        exitCode: Int32?,
        durationMs: Int?
    ) {
        let event = DiagnosticEvent(
            timestamp: Self.timestamp(),
            sessionID: sessionID,
            application: application,
            kind: kind,
            command: Self.safeCommand(command),
            stage: Self.safeStage(stage),
            failureCode: Self.safeIdentifier(failureCode),
            diagnosticCode: Self.safeIdentifier(diagnosticCode),
            exitCode: exitCode.map { min(max($0, -1), 255) },
            durationMs: durationMs.map { min(max($0, 0), 7 * 24 * 60 * 60 * 1_000) }
        )
        do {
            var line = try encoder.encode(event)
            line.append(0x0A)
            guard line.count <= 2_048 else { throw DiagnosticLogError.unsafeLogFile }
            try ensureDirectory()
            try rotateIfNeeded(appending: line.count)
            try append(line, to: activeLog)
        } catch {
            if droppedEventCount < Int.max { droppedEventCount += 1 }
        }
    }

    public func export(to destination: URL) throws -> DiagnosticExportSummary {
        record(
            .supportExportRequested,
            command: nil,
            stage: nil,
            failureCode: nil,
            diagnosticCode: nil,
            exitCode: nil,
            durationMs: nil
        )
        let destination = destination.standardizedFileURL
        guard destination.isFileURL, destination.path.hasPrefix("/"),
              destination != URL(fileURLWithPath: "/", isDirectory: true),
              destination != FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL else {
            throw DiagnosticLogError.destinationMustBeNew
        }
        guard !FileManager.default.fileExists(atPath: destination.path) else {
            throw DiagnosticLogError.destinationMustBeNew
        }

        try ensureDirectory()
        let loaded = try loadEvents()
        let report = DiagnosticSupportReport(
            schemaVersion: DiagnosticSupportReport.schema,
            generatedAt: Self.timestamp(),
            privacyNotice: "This local report contains bounded operational metadata only. Review it before sharing it with Podcast Visualizer support.",
            excludedData: Self.excludedData,
            droppedEventCount: droppedEventCount,
            skippedInvalidRecordCount: loaded.skipped,
            events: Array(loaded.events.suffix(Self.maximumExportedEvents))
        )
        let reportEncoder = JSONEncoder()
        reportEncoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let output = try reportEncoder.encode(report)
        try writeNewReport(output, to: destination)
        return DiagnosticExportSummary(
            destination: destination,
            eventCount: report.events.count,
            droppedEventCount: report.droppedEventCount,
            skippedInvalidRecordCount: report.skippedInvalidRecordCount
        )
    }

    private func ensureDirectory() throws {
        let manager = FileManager.default
        var status = stat()
        let result = directory.path.withCString { Darwin.lstat($0, &status) }
        if result == 0 {
            guard (status.st_mode & S_IFMT) == S_IFDIR else {
                throw DiagnosticLogError.unsafeDirectory
            }
        } else if errno == ENOENT {
            try manager.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } else {
            throw DiagnosticLogError.writeFailed(errno)
        }
        guard directory.resolvingSymlinksInPath() == directory else {
            throw DiagnosticLogError.unsafeDirectory
        }
        try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    }

    private func rotateIfNeeded(appending byteCount: Int) throws {
        let manager = FileManager.default
        let currentBytes = try safeRegularFileSize(activeLog) ?? 0
        guard currentBytes > 0, currentBytes + byteCount > maximumLogBytes else { return }
        if try safeRegularFileSize(previousLog) != nil {
            try manager.removeItem(at: previousLog)
        }
        try manager.moveItem(at: activeLog, to: previousLog)
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: previousLog.path)
    }

    private func append(_ data: Data, to url: URL) throws {
        let manager = FileManager.default
        if try safeRegularFileSize(url) == nil {
            guard manager.createFile(
                atPath: url.path,
                contents: nil,
                attributes: [.posixPermissions: 0o600]
            ) else {
                throw DiagnosticLogError.unsafeLogFile
            }
        }
        _ = try safeRegularFileSize(url)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }

    private func safeRegularFileSize(_ url: URL) throws -> Int? {
        var status = stat()
        let result = url.path.withCString { Darwin.lstat($0, &status) }
        if result != 0 {
            if errno == ENOENT { return nil }
            throw DiagnosticLogError.writeFailed(errno)
        }
        guard (status.st_mode & S_IFMT) == S_IFREG,
              status.st_size >= 0, status.st_size <= maximumLogBytes else {
            throw DiagnosticLogError.unsafeLogFile
        }
        return Int(status.st_size)
    }

    private func loadEvents() throws -> (events: [DiagnosticEvent], skipped: Int) {
        var events: [DiagnosticEvent] = []
        var skipped = 0
        for url in [previousLog, activeLog] {
            guard let size = try safeRegularFileSize(url), size > 0 else { continue }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            for line in data.split(separator: 0x0A, omittingEmptySubsequences: true) {
                guard line.count <= 2_048,
                      Self.hasOnlyKnownFields(Data(line)),
                      let event = try? decoder.decode(DiagnosticEvent.self, from: Data(line)),
                      Self.isValid(event) else {
                    skipped += 1
                    continue
                }
                events.append(event)
            }
        }
        return (events, skipped)
    }

    private func writeNewReport(_ data: Data, to destination: URL) throws {
        let descriptor = destination.path.withCString {
            Darwin.open($0, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, S_IRUSR | S_IWUSR)
        }
        guard descriptor >= 0 else {
            if errno == EEXIST { throw DiagnosticLogError.destinationMustBeNew }
            throw DiagnosticLogError.writeFailed(errno)
        }
        var completed = false
        defer {
            Darwin.close(descriptor)
            if !completed { try? FileManager.default.removeItem(at: destination) }
        }
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { bytes in
                Darwin.write(
                    descriptor,
                    bytes.baseAddress!.advanced(by: offset),
                    data.count - offset
                )
            }
            if written < 0 {
                if errno == EINTR { continue }
                throw DiagnosticLogError.writeFailed(errno)
            }
            guard written > 0 else { throw DiagnosticLogError.writeFailed(EIO) }
            offset += written
        }
        guard Darwin.fsync(descriptor) == 0 else {
            throw DiagnosticLogError.writeFailed(errno)
        }
        completed = true
    }

    private static func safeCommand(_ value: String?) -> String? {
        guard let value, value.utf8.count <= 48 else { return nil }
        let allowed = value.unicodeScalars.allSatisfy {
            CharacterSet.lowercaseLetters.contains($0) || CharacterSet.decimalDigits.contains($0)
                || $0 == " " || $0 == "-"
        }
        return allowed ? value : nil
    }

    private static func safeStage(_ value: String?) -> String? {
        guard let value, WorkflowStage.allCases.map(\.rawValue).contains(value) else { return nil }
        return value
    }

    private static func safeIdentifier(_ value: String?) -> String? {
        guard let value, isIdentifier(value, maximumBytes: 64) else { return nil }
        return value
    }

    private static func isIdentifier(_ value: String, maximumBytes: Int) -> Bool {
        guard !value.isEmpty, value.utf8.count <= maximumBytes,
              let first = value.unicodeScalars.first,
              CharacterSet.lowercaseLetters.contains(first) || CharacterSet.decimalDigits.contains(first) else {
            return false
        }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.lowercaseLetters.contains($0) || CharacterSet.decimalDigits.contains($0)
                || $0 == "_" || $0 == "-"
        }
    }

    private static func hasOnlyKnownFields(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys).isSubset(of: [
                  "schemaVersion", "timestamp", "sessionID", "application", "kind", "command",
                  "stage", "failureCode", "diagnosticCode", "exitCode", "durationMs",
              ]),
              let application = object["application"] as? [String: Any],
              Set(application.keys).isSubset(of: [
                  "version", "build", "operatingSystem", "architecture",
              ]) else {
            return false
        }
        return true
    }

    private static func isValid(_ event: DiagnosticEvent) -> Bool {
        guard event.schemaVersion == DiagnosticEvent.schema,
              event.timestamp.utf8.count <= 40,
              iso8601Formatter().date(from: event.timestamp) != nil,
              isIdentifier(event.sessionID, maximumBytes: 64),
              DiagnosticApplicationInfo(
                  version: event.application.version,
                  build: event.application.build,
                  operatingSystem: event.application.operatingSystem,
                  architecture: event.application.architecture
              ) == event.application,
              safeCommand(event.command) == event.command,
              safeStage(event.stage) == event.stage,
              safeIdentifier(event.failureCode) == event.failureCode,
              safeIdentifier(event.diagnosticCode) == event.diagnosticCode,
              event.exitCode.map({ (-1...255).contains($0) }) ?? true,
              event.durationMs.map({ (0...7 * 24 * 60 * 60 * 1_000).contains($0) }) ?? true else {
            return false
        }
        return true
    }

    private static func timestamp(_ date: Date = Date()) -> String {
        iso8601Formatter().string(from: date)
    }

    private static func iso8601Formatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }
}

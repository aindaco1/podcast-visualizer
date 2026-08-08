import Foundation

public enum CLICommandError: Error, Equatable, Sendable {
    case executableMustBeAbsolute
    case pathMustBeAbsolute(String)
    case unsafeArgument
    case invalidClip
    case invalidMaximumSpeakers
}

public struct ClipRange: Equatable, Sendable {
    public let startsAtMs: Int
    public let endsAtMs: Int

    public init(startsAtMs: Int, endsAtMs: Int) throws {
        guard startsAtMs >= 0, endsAtMs > startsAtMs,
              endsAtMs - startsAtMs <= 24 * 60 * 60 * 1000 else {
            throw CLICommandError.invalidClip
        }
        self.startsAtMs = startsAtMs
        self.endsAtMs = endsAtMs
    }

    public static func full(durationMs: Int) throws -> ClipRange {
        try ClipRange(startsAtMs: 0, endsAtMs: durationMs)
    }

    public var argument: String {
        "\(Self.clock(startsAtMs))-\(Self.clock(endsAtMs))"
    }

    private static func clock(_ milliseconds: Int) -> String {
        let hours = milliseconds / 3_600_000
        let minutes = milliseconds / 60_000 % 60
        let seconds = milliseconds / 1_000 % 60
        let fraction = milliseconds % 1_000
        return String(format: "%02d:%02d:%02d.%03d", hours, minutes, seconds, fraction)
    }
}

public struct CLICommand: Equatable, Sendable {
    public let executable: URL
    public let arguments: [String]
    public let label: String

    public init(executable: URL, arguments: [String], label: String) throws {
        guard executable.isFileURL, executable.path.hasPrefix("/") else {
            throw CLICommandError.executableMustBeAbsolute
        }
        guard arguments.count <= 128,
              arguments.allSatisfy({ !$0.isEmpty && $0.count <= 4096 && !$0.contains("\0") }) else {
            throw CLICommandError.unsafeArgument
        }
        self.executable = executable
        self.arguments = arguments
        self.label = label
    }
}

public struct CLICommandBuilder: Sendable {
    public let executable: URL
    public let progressDescriptor: Int32

    public init(executable: URL, progressDescriptor: Int32 = 3) throws {
        guard executable.isFileURL, executable.path.hasPrefix("/") else {
            throw CLICommandError.executableMustBeAbsolute
        }
        guard (3...63).contains(progressDescriptor) else { throw CLICommandError.unsafeArgument }
        self.executable = executable
        self.progressDescriptor = progressDescriptor
    }

    public func probe(source: URL) throws -> CLICommand {
        try command("probe", ["--source", absolute(source)])
    }

    public func initialize(source: URL, project: URL, clip: ClipRange) throws -> CLICommand {
        try command("init", [
            "--source", absolute(source), "--project", absolute(project), "--clip", clip.argument,
        ])
    }

    public func status(project: URL) throws -> CLICommand {
        try command("status", ["--project", absolute(project)])
    }

    public func prepare(project: URL) throws -> CLICommand {
        try command("prepare", ["--project", absolute(project)])
    }

    public func analyze(
        project: URL,
        parakeetModel: URL? = nil,
        maximumSpeakers: Int = 6,
        expectedSpeakers: Int? = nil
    ) throws -> CLICommand {
        guard (1...6).contains(maximumSpeakers) else { throw CLICommandError.invalidMaximumSpeakers }
        if let expectedSpeakers {
            guard (1...maximumSpeakers).contains(expectedSpeakers) else {
                throw CLICommandError.invalidMaximumSpeakers
            }
        }
        var arguments = ["--project", try absolute(project)]
        if let parakeetModel { arguments += ["--parakeet-model", try absolute(parakeetModel)] }
        arguments += ["--maximum-speakers", String(maximumSpeakers)]
        if let expectedSpeakers { arguments += ["--expected-speakers", String(expectedSpeakers)] }
        return try command("analyze", arguments)
    }

    public func review(project: URL) throws -> CLICommand {
        try command("review", ["--project", absolute(project), "--no-open"])
    }

    public func loadReview(project: URL) throws -> CLICommand {
        try command("review", ["load", "--project", absolute(project)], label: "review load")
    }

    public func saveReview(project: URL, input: URL) throws -> CLICommand {
        try command("review", ["save", "--project", absolute(project), "--input", absolute(input)], label: "review save")
    }

    public func approveReview(project: URL, input: URL) throws -> CLICommand {
        try command("review", ["approve", "--project", absolute(project), "--input", absolute(input)], label: "review approve")
    }

    public func align(project: URL, transcriptID: String? = nil) throws -> CLICommand {
        var arguments = ["--project", try absolute(project)]
        if let transcriptID { arguments += ["--transcript", transcriptID] }
        return try command("align", arguments)
    }

    public func render(project: URL, selection: RenderSelection) throws -> [CLICommand] {
        try selection.invocations().map { invocation in
            try command("render", [
                "--project", absolute(project),
                "--aspect", invocation.aspect,
                "--background", invocation.background,
                "--alpha-codec", invocation.alphaCodec,
            ])
        }
    }

    public func modelsStatus(parakeetModel: URL? = nil) throws -> CLICommand {
        var arguments = ["status"]
        if let parakeetModel { arguments += ["--parakeet-model", try absolute(parakeetModel)] }
        return try command("models", arguments, label: "models status")
    }

    public func importModel(_ model: String, source: URL) throws -> CLICommand {
        guard ["parakeet-v3", "align-en"].contains(model) else { throw CLICommandError.unsafeArgument }
        return try command("models", ["import", model, "--source", absolute(source)], label: "models import")
    }

    public func doctor() throws -> CLICommand {
        try command("doctor", [])
    }

    private func command(_ name: String, _ arguments: [String], label: String? = nil) throws -> CLICommand {
        try CLICommand(
            executable: executable,
            arguments: [name] + arguments + ["--json", "--progress-fd", String(progressDescriptor)],
            label: label ?? name
        )
    }

    private func absolute(_ url: URL) throws -> String {
        guard url.isFileURL, url.path.hasPrefix("/") else {
            throw CLICommandError.pathMustBeAbsolute(url.path)
        }
        return url.standardizedFileURL.path
    }
}

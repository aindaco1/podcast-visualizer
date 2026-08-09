import Foundation
import Testing
@testable import PodcastVisualizerSpeechProtocol

@Suite("Speech progress reporter")
struct SpeechProgressReporterTests {
    @Test("writes sequenced progress to the supplied descriptor and ignores non-finite updates")
    func writesDedicatedProgress() throws {
        let pipe = Pipe()
        let reporter = SpeechProgressReporter(
            fileDescriptor: pipe.fileHandleForWriting.fileDescriptor
        )

        reporter.report(phase: "loading-transcription-model")
        reporter.report(phase: "transcription", fraction: .nan)
        reporter.report(phase: "transcription", fraction: 0.5)
        try pipe.fileHandleForWriting.close()

        let lines = try #require(
            String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
        ).split(separator: "\n")
        #expect(lines.count == 2)
        let first = try #require(
            JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as? [String: Any]
        )
        let second = try #require(
            JSONSerialization.jsonObject(with: Data(lines[1].utf8)) as? [String: Any]
        )
        #expect(first["schemaVersion"] as? String == speechProgressSchema)
        #expect(first["sequence"] as? Int == 1)
        #expect(second["sequence"] as? Int == 2)
        #expect(second["fraction"] as? Double == 0.5)
    }
}

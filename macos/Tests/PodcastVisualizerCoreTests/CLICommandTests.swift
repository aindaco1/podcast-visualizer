import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("CLI command builder")
struct CLICommandTests {
    let executable = URL(fileURLWithPath: "/Applications/Podcast Visualizer.app/Contents/Resources/CLI/bin/dustwave-video")
    let source = URL(fileURLWithPath: "/Users/example/Podcast/input.wav")
    let project = URL(fileURLWithPath: "/Users/example/Podcast/project")

    @Test("builds exact argument arrays without shell text")
    func exactArguments() throws {
        let builder = try CLICommandBuilder(executable: executable)
        let clip = try ClipRange.full(durationMs: 90_125)
        #expect(try builder.probe(source: source).arguments == [
            "probe", "--source", source.path, "--json", "--progress-fd", "3",
        ])
        #expect(try builder.initialize(source: source, project: project, clip: clip).arguments == [
            "init", "--source", source.path, "--project", project.path,
            "--clip", "00:00:00.000-00:01:30.125", "--json", "--progress-fd", "3",
        ])
        #expect(try builder.review(project: project).arguments == [
            "review", "--project", project.path, "--no-open", "--json", "--progress-fd", "3",
        ])
        #expect(try builder.loadReview(project: project).arguments == [
            "review", "load", "--project", project.path, "--json", "--progress-fd", "3",
        ])
        let edit = URL(fileURLWithPath: "/private/tmp/review-edit.json")
        #expect(try builder.saveReview(project: project, input: edit).arguments == [
            "review", "save", "--project", project.path, "--input", edit.path,
            "--json", "--progress-fd", "3",
        ])
        #expect(try builder.approveReview(project: project, input: edit).arguments == [
            "review", "approve", "--project", project.path, "--input", edit.path,
            "--json", "--progress-fd", "3",
        ])
        #expect(try builder.analyze(project: project, expectedSpeakers: 2).arguments.contains("--expected-speakers"))
        #expect(try builder.modelsStatus().arguments == [
            "models", "status", "--json", "--progress-fd", "3",
        ])
        #expect(try builder.doctor().arguments == [
            "doctor", "--json", "--progress-fd", "3",
        ])
    }

    @Test("maps all aspect and delivery selections")
    func renderArguments() throws {
        let builder = try CLICommandBuilder(executable: executable)
        for aspect in RenderAspect.allCases {
            for profile in DeliveryProfile.allCases {
                let commands = try builder.render(
                    project: project,
                    selection: RenderSelection(aspects: [aspect], profiles: [profile])
                )
                #expect(commands.count == 1)
                #expect(commands[0].arguments.contains(aspect.rawValue))
            }
        }

        let all = try builder.render(
            project: project,
            selection: RenderSelection(
                aspects: Set(RenderAspect.allCases),
                profiles: Set(DeliveryProfile.allCases)
            )
        )
        #expect(all.count == 1)
        #expect(all[0].arguments.contains("all"))
        #expect(all[0].arguments.contains("both"))
        #expect(all[0].arguments.filter { $0 == "both" }.count == 2)

        let twoAspects = try builder.render(
            project: project,
            selection: RenderSelection(aspects: [.landscape, .portrait], profiles: [.opaque])
        )
        #expect(twoAspects.count == 2)
    }

    @Test("rejects unsafe path and range inputs")
    func rejectsUnsafeInputs() {
        #expect(throws: CLICommandError.self) {
            try CLICommandBuilder(executable: URL(string: "relative")!)
        }
        #expect(throws: CLICommandError.self) {
            try ClipRange(startsAtMs: 100, endsAtMs: 100)
        }
        #expect(throws: CLICommandError.self) {
            try CLICommand(
                executable: executable,
                arguments: ["status", "bad\0argument"],
                label: "status"
            )
        }
    }
}

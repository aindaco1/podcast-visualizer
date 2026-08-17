import Foundation
import PodcastVisualizerCore

actor DemoCLIClient: CLIExecuting {
    private var cancelled = false

    func run(
        _ command: CLICommand,
        onProgress: @escaping @Sendable (CLIProgressEvent) async -> Void
    ) async throws -> CLIExecution {
        cancelled = false
        let name = command.arguments[0]
        let reviewAction = name == "review" && command.arguments.indices.contains(1)
            && !command.arguments[1].hasPrefix("--") ? command.arguments[1] : nil
        let modelsAction = name == "models" && command.arguments.indices.contains(1)
            ? command.arguments[1] : nil
        await onProgress(try progress(command: name, sequence: 1, event: "command.started"))
        var sequence = 1
        if name == "analyze" {
            for detail: [String: Any] in [
                ["phase": "loading-transcription-model"],
                ["phase": "transcription", "fraction": 0.42],
                ["phase": "diarization-scan", "fraction": 0.76],
                ["phase": "diarization-finalizing"],
            ] {
                try await Task.sleep(for: .milliseconds(300))
                sequence += 1
                await onProgress(try progress(
                    command: name, sequence: sequence, event: "analysis.progress", detail: detail
                ))
            }
        } else if name == "render" {
            for fraction in [0.12, 0.48, 0.81, 1.0] {
                try await Task.sleep(for: .milliseconds(300))
                sequence += 1
                await onProgress(try progress(
                    command: name,
                    sequence: sequence,
                    event: "render.progress",
                    detail: ["phase": "encoding", "fraction": fraction, "outputIndex": 1, "totalOutputs": 1]
                ))
            }
            sequence += 1
            await onProgress(try progress(
                command: name, sequence: sequence, event: "render.progress", detail: ["phase": "verifying"]
            ))
        } else if name == "models", modelsAction == "download" {
            for fraction in [0.08, 0.34, 0.71, 1.0] {
                try await Task.sleep(for: .milliseconds(220))
                sequence += 1
                await onProgress(try progress(
                    command: name,
                    sequence: sequence,
                    event: "model.download",
                    detail: ["phase": "downloading-model", "fraction": fraction]
                ))
            }
            sequence += 1
            await onProgress(try progress(
                command: name,
                sequence: sequence,
                event: "model.download",
                detail: ["phase": "verifying-model"]
            ))
        } else {
            try await Task.sleep(for: .milliseconds(name == "review" && reviewAction == nil ? 1_200 : 220))
        }
        try Task.checkCancellation()
        if cancelled { throw CancellationError() }

        if name == "review", reviewAction == nil {
            await onProgress(try progress(
                command: name,
                sequence: sequence + 1,
                event: "review.ready",
                detail: [
                    "reviewUrl": "http://127.0.0.1:49152/#token=development-fixture",
                    "state": "review_required",
                ]
            ))
            sequence += 1
            try await Task.sleep(for: .milliseconds(1_800))
            try Task.checkCancellation()
            if cancelled { throw CancellationError() }
        }

        let output = try output(for: command)
        await onProgress(try progress(
            command: name,
            sequence: sequence + 1,
            event: "command.completed"
        ))
        return CLIExecution(
            exitCode: 0,
            standardOutput: try JSONSerialization.data(withJSONObject: output),
            standardError: Data()
        )
    }

    func cancelCurrentCommand() {
        cancelled = true
    }

    private func progress(
        command: String,
        sequence: Int,
        event: String,
        detail: [String: Any] = [:]
    ) throws -> CLIProgressEvent {
        try ContractDecoder.decode(
            CLIProgressEvent.self,
            from: JSONSerialization.data(withJSONObject: [
                "schemaVersion": CLIProgressEvent.schema,
                "sequence": sequence,
                "command": command,
                "event": event,
                "detail": detail,
            ]),
            maximumBytes: 8 * 1024
        )
    }

    private func output(for command: CLICommand) throws -> Any {
        let arguments = command.arguments
        let name = arguments[0]
        let reviewAction = name == "review" && arguments.indices.contains(1)
            && !arguments[1].hasPrefix("--") ? arguments[1] : nil
        let chapterAction = name == "chapters" && arguments.indices.contains(1)
            ? arguments[1] : nil
        let project = value(after: "--project", in: arguments) ?? "/Users/example/Podcast/project"
        let source = value(after: "--source", in: arguments) ?? "\(project)/source/original.wav"
        let digest = String(repeating: "a", count: 64)
        switch name {
        case "models":
            if arguments.indices.contains(2), ["import", "download"].contains(arguments[1]) {
                let model = arguments[2]
                return [
                    "model": model,
                    "destination": "/Users/example/Library/Application Support/Podcast Visualizer/Models/\(model)",
                    "reused": false,
                    "version": digest,
                ]
            }
            return [
                "ok": true,
                "checks": [
                    [
                        "id": "parakeet-v3", "ok": true,
                        "modelRoot": "/Users/example/Models/parakeet-v3",
                        "detail": "Parakeet fixture",
                    ],
                    [
                        "id": "align-en", "ok": true,
                        "modelRoot": "/Users/example/Models/align-en",
                        "detail": "Alignment fixture",
                    ],
                    [
                        "id": "diarization", "ok": true,
                        "modelRoot": NSNull(), "detail": "Bundled fixture",
                    ],
                ],
            ]
        case "probe":
            return [
                "schemaVersion": MediaProbeResult.schema,
                "sourcePath": source,
                "bytes": 12_582_912,
                "durationMs": 3_725_000,
                "audio": ["codec": "aac", "sampleRate": 48_000, "channels": 2],
            ]
        case "init":
            return [
                "projectRoot": project,
                "projectId": "project_aaaaaaaaaaaaaaaa_20260807010203",
                "state": "initialized",
                "manifestSha256": digest,
            ]
        case "status":
            return [
                "projectRoot": project,
                "projectId": "project_aaaaaaaaaaaaaaaa_20260807010203",
                "state": "review_required",
                "sourcePath": "\(project)/source/original.wav",
                "sourceSha256": digest,
                "clip": ["startsAtMs": 0, "endsAtMs": 3_725_000, "durationMs": 3_725_000],
            ]
        case "branding":
            return [
                "schemaVersion": ProjectBrandingWorkspace.schema,
                "projectRoot": project,
                "podcastName": "Dust Wave Podcast",
                "organizationName": "Dust Wave",
                "showSpeakerNames": true,
                "logo": NSNull(),
                "hasSavedSettings": arguments.contains("save"),
            ]
        case "prepare":
            return [
                "projectRoot": project,
                "analysis": media(path: "source/analysis.wav", bytes: 238_400_000, digest: digest),
                "review": media(path: "source/review.wav", bytes: 119_200_000, digest: digest),
                "analysisPath": "\(project)/source/analysis.wav",
                "reviewPath": "\(project)/source/review.wav",
                "manifestSha256": digest,
            ]
        case "analyze":
            return [
                "speechPath": "\(project)/analysis/speech.json",
                "speakersPath": "\(project)/analysis/speaker-turns.json",
                "draftPath": "\(project)/review/draft.json",
                "words": 5_842,
                "speakers": 3,
                "cues": 612,
            ]
        case "review":
            if reviewAction == "load" {
                return [
                    "schemaVersion": ReviewWorkspace.schema,
                    "projectRoot": project,
                    "draftManifestSha256": digest,
                    "baseTranscriptId": NSNull(),
                    "baseRevisionSha256": NSNull(),
                    "audioPath": "\(project)/source/review.wav",
                    "durationMs": 3_725_000,
                    "speakers": [
                        ["id": "speaker-01", "displayName": "Speaker 1"],
                        ["id": "speaker-02", "displayName": "Speaker 2"],
                        ["id": "speaker-03", "displayName": "Speaker 3"],
                    ],
                    "cues": demoReviewCues(),
                    "hasWorkingCopy": false,
                ]
            }
            if reviewAction == "save" {
                return ["ok": true, "workingSha256": digest]
            }
            if reviewAction == "approve" {
                return [
                    "state": "approved",
                    "transcriptId": "transcript_aaaaaaaaaaaaaaaaaaaaaaaa",
                    "contentSha256": digest,
                    "manifestSha256": digest,
                ]
            }
            return [
                "reviewUrl": "http://127.0.0.1:49152/#token=development-fixture",
                "state": "approved",
                "transcriptId": "transcript_aaaaaaaaaaaaaaaaaaaaaaaa",
                "contentSha256": digest,
                "manifestSha256": digest,
            ]
        case "align":
            return [
                "alignmentRevisionId": "align_aaaaaaaaaaaaaaaaaaaaaaaa",
                "resultPath": "\(project)/alignment/result.json",
                "qualityPath": "\(project)/alignment/quality.json",
                "quality": [
                    "schemaVersion": "alignment-result-quality-v1",
                    "wordCount": 5_842,
                    "alignedWordCount": 5_842,
                    "unalignedWordCount": 0,
                    "interpolatedWordCount": 0,
                    "invalidWordCount": 0,
                    "projectionIssueCount": 0,
                    "alignedWordRatio": 1.0,
                    "structurallyEligible": true,
                ],
            ]
        case "chapters":
            let mode = value(after: "--mode", in: arguments) ?? "topics"
            let contextID = "chapter_context_aaaaaaaaaaaaaaaaaaaaaaaa"
            let revisionID = "chapters_aaaaaaaaaaaaaaaaaaaaaaaa"
            if chapterAction == "load" {
                return demoChapterWorkspace(
                    project: project, mode: mode, contextID: contextID, digest: digest
                )
            }
            if chapterAction == "save" {
                let count = try chapterEditCount(arguments)
                return [
                    "contextId": contextID,
                    "workingPath": "\(project)/chapters/working/\(contextID).json",
                    "entries": count,
                ]
            }
            if chapterAction == "approve" {
                return [
                    "state": "approved",
                    "chapterRevisionId": revisionID,
                    "manifestSha256": digest,
                    "revisionPath": "\(project)/chapters/revisions/\(revisionID)-approved.json",
                    "chapters": try chapterEditCount(arguments),
                ]
            }
            let format = value(after: "--format", in: arguments) ?? "youtube"
            return [
                "format": format,
                "outputPath": "\(project)/chapters/exports/\(revisionID).\(format)",
                "content": "00:00 - Opening\n01:00 - Main topic\n02:00 - Closing\n",
                "chapterRevisionId": revisionID,
                "manifestSha256": digest,
            ]
        case "render":
            let aspectArgument = value(after: "--aspect", in: arguments) ?? "16:9"
            let aspects = aspectArgument == "all" ? ["16:9", "1:1", "9:16"] : [aspectArgument]
            let background = value(after: "--background", in: arguments) ?? "transparent"
            let alpha = value(after: "--alpha-codec", in: arguments) ?? "hevc"
            return aspects.map { aspect in
                let dimensions = aspect == "16:9" ? (1_920, 1_080) : aspect == "1:1" ? (1_080, 1_080) : (1_080, 1_920)
                let profile = background == "opaque" ? "opaque" : "transparent-\(alpha)"
                return [
                    "aspect": aspect,
                    "background": background == "both" ? "opaque" : background,
                    "alphaCodec": background == "opaque" ? NSNull() : alpha,
                    "videoCodec": background == "opaque" ? "h264_videotoolbox" : "hevc_videotoolbox",
                    "outputPath": "\(project)/renders/\(aspect.replacingOccurrences(of: ":", with: "x"))-\(profile).mov",
                    "manifestPath": "\(project)/renders/render_\(aspect.replacingOccurrences(of: ":", with: "x")).json",
                    "sha256": digest,
                    "bytes": background == "opaque" ? 88_000_000 : 42_000_000,
                    "durationMs": 3_725_000,
                    "width": dimensions.0,
                    "height": dimensions.1,
                    "frameRate": 24.0,
                    "audioCodec": "aac",
                ] as [String: Any]
            }
        default:
            return [:]
        }
    }

    private func chapterEditCount(_ arguments: [String]) throws -> Int {
        guard let path = value(after: "--input", in: arguments) else { return 3 }
        return try JSONDecoder().decode(
            ChapterEditPayload.self,
            from: Data(contentsOf: URL(fileURLWithPath: path))
        ).entries.count
    }

    private func demoChapterWorkspace(
        project: String,
        mode: String,
        contextID: String,
        digest: String
    ) -> [String: Any] {
        let records: [[String: Any]] = [
            (0, "Opening and welcome to the show."),
            (60_000, "The main production topic begins here."),
            (120_000, "Closing notes and the release checklist."),
        ].enumerated().map { index, item in
            [
                "anchorId": "chapter_anchor_cue_\(String(format: "%06d", index + 1))",
                "sourceCueId": "cue_\(String(format: "%06d", index + 1))",
                "sourceWordId": "word_fixture_\(index + 1)",
                "startsAtMs": item.0,
                "spokenStartsAtMs": item.0,
                "endsAtMs": item.0 + 10_000,
                "speakerId": "speaker-01",
                "text": item.1,
            ]
        }
        let context: [String: Any] = [
            "schemaVersion": ChapterContext.schema,
            "policyVersion": ChapterContext.policyVersion,
            "mode": mode,
            "durationMs": 180_000,
            "policy": [
                "targetWindowDurationMs": 240_000,
                "maximumWindowDurationMs": 360_000,
                "maximumWindowCues": 80,
                "maximumWindowCharacters": 8_000,
                "minimumChapterDurationMs": 10_000,
                "maximumChapters": 200,
                "maximumTitleCharacters": 100,
            ],
            "windows": [[
                "windowId": "chapter_window_0001",
                "startsAtMs": 0,
                "endsAtMs": 130_000,
                "eligibleAnchorIds": records.map { $0["anchorId"]! },
                "records": records,
            ]],
        ]
        let artifact: [String: Any] = [
            "schemaVersion": ChapterContextArtifact.schema,
            "contextId": contextID,
            "projectId": "project_aaaaaaaaaaaaaaaa_20260807010203",
            "sourceAudioSha256": digest,
            "transcriptId": "transcript_aaaaaaaaaaaaaaaaaaaaaaaa",
            "transcriptManifestSha256": digest,
            "alignmentRevisionId": "alignment_aaaaaaaaaaaaaaaaaaaaaaaa",
            "alignmentManifestSha256": digest,
            "mode": mode,
            "context": context,
            "manifestSha256": digest,
        ]
        return [
            "schemaVersion": ChapterWorkspace.schema,
            "projectRoot": project,
            "contextPath": "\(project)/chapters/contexts/\(contextID).json",
            "workingPath": "\(project)/chapters/working/\(contextID).json",
            "contextArtifact": artifact,
            "edit": [
                "schemaVersion": ChapterEditPayload.schema,
                "contextId": contextID,
                "contextManifestSha256": digest,
                "entries": [],
            ],
            "approved": NSNull(),
        ]
    }

    private func value(after option: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: option), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private func media(path: String, bytes: Int, digest: String) -> [String: Any] {
        [
            "relativePath": path,
            "bytes": bytes,
            "sha256": digest,
            "durationMs": 3_725_000,
            "sampleRate": 16_000,
            "channels": 1,
        ]
    }

    private func demoReviewCues() -> [[String: Any]] {
        [
            [
                "id": "cue_000001", "startsAtMs": 0, "endsAtMs": 3_800,
                "textMarkdown": "Welcome back to the show. Today we're talking about local creative tools.",
                "speakerLabel": "speaker-01", "speakerConfirmed": false,
                "speakerConfidence": 0.94, "speakerAmbiguous": false,
            ],
            [
                "id": "cue_000002", "startsAtMs": 4_100, "endsAtMs": 8_600,
                "textMarkdown": "Lucid link changed how our team moves large media files.",
                "speakerLabel": "speaker-03", "speakerConfirmed": false,
                "speakerConfidence": 0.61, "speakerAmbiguous": true,
            ],
            [
                "id": "cue_000003", "startsAtMs": 9_000, "endsAtMs": 13_200,
                "textMarkdown": "The important part is keeping the entire review workflow on this Mac.",
                "speakerLabel": "speaker-02", "speakerConfirmed": false,
                "speakerConfidence": 0.88, "speakerAmbiguous": false,
            ],
        ]
    }
}

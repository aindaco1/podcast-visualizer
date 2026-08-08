import Foundation
import PodcastVisualizerCore

let cues = (1...10_000).map { index in
    ReviewCue(
        id: String(format: "cue_%06d", index),
        startsAtMs: (index - 1) * 10,
        endsAtMs: index * 10,
        textMarkdown: index.isMultiple(of: 100) ? "Find this phrase." : "No match here.",
        speakerLabel: "speaker-01",
        speakerConfirmed: true,
        speakerConfidence: 1,
        speakerAmbiguous: false
    )
}
func measure(_ operation: () -> Int) -> ([Double], Int) {
    var samples: [Double] = []
    var result = 0
    for _ in 0..<9 {
        let started = DispatchTime.now().uptimeNanoseconds
        result = operation()
        samples.append(Double(DispatchTime.now().uptimeNanoseconds - started) / 1e6)
    }
    return (samples.sorted(), result)
}

let (searchSamples, matchCount) = measure {
    ReviewEditing.matches(
        "Find this phrase",
        in: cues,
        caseSensitive: true,
        wholeWords: false
    ).count
}
let firstMatch = ReviewEditing.matches(
    "Find this phrase", in: cues, caseSensitive: true, wholeWords: false
)[0]
let (replaceOneSamples, replaceOneCount) = measure {
    ReviewEditing.replace(
        firstMatch,
        search: "Find this phrase",
        with: "Found",
        in: cues,
        caseSensitive: true,
        wholeWords: false
    ).replacements
}
let (replaceAllSamples, replaceAllCount) = measure {
    ReviewEditing.replaceAll(
        "Find this phrase",
        with: "Found",
        in: cues,
        caseSensitive: true,
        wholeWords: false
    ).replacements
}
let (navigationSamples, navigationResult) = measure {
    var current: Int? = nil
    for _ in 0..<100_000 {
        current = ReviewEditing.navigatedMatchIndex(
            current: current, count: matchCount, direction: 1
        )
    }
    return current ?? -1
}
func timing(_ samples: [Double]) -> [String: Double] {
    [
        "medianMs": samples[samples.count / 2],
        "worstMs": samples.max() ?? 0
    ]
}
let evidence: [String: Any] = [
    "cues": cues.count,
    "matches": matchCount,
    "runs": searchSamples.count,
    "search": timing(searchSamples),
    "replaceOne": timing(replaceOneSamples).merging(["replacements": Double(replaceOneCount)]) { _, new in new },
    "replaceAll": timing(replaceAllSamples).merging(["replacements": Double(replaceAllCount)]) { _, new in new },
    "navigate100000": timing(navigationSamples).merging(["finalIndex": Double(navigationResult)]) { _, new in new }
]
let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))

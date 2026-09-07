import PodcastVisualizerCore
import SwiftUI

/// Swift string indices belong to the text that produced them. A split, merge,
/// replacement, or Undo can change that text before SwiftUI updates its selection.
@MainActor
struct TranscriptTextSelection {
    private var sourceText: String?
    private var value: TextSelection?

    mutating func set(_ selection: TextSelection?, in text: String) {
        sourceText = text
        value = selection
    }

    func selection(in text: String) -> TextSelection? {
        guard let sourceText, sourceText.utf8.elementsEqual(text.utf8) else { return nil }
        return value
    }

    func insertionOffset(in text: String) -> Int? {
        guard let selection = selection(in: text), selection.isInsertion else { return nil }
        switch selection.indices {
        case .selection(let range):
            guard range.isEmpty else { return nil }
            return range.lowerBound.utf16Offset(in: text)
        case .multiSelection:
            return nil
        @unknown default:
            return nil
        }
    }

    /// Review has cue timing, not a verified word-to-text alignment. This is a
    /// navigation estimate only; it never changes a cue's text or timestamps.
    func estimatedPlayheadMs(in cue: ReviewCue) -> Int? {
        let text = cue.textMarkdown
        guard let offset = insertionOffset(in: text), !text.isEmpty,
              cue.startsAtMs >= 0, cue.endsAtMs > cue.startsAtMs,
              let boundary = Range(NSRange(location: offset, length: 0), in: text)?.lowerBound,
              boundary == text.endIndex || text.indices.contains(boundary)
        else { return nil }
        if boundary == text.startIndex { return cue.startsAtMs }
        if boundary == text.endIndex { return cue.endsAtMs }
        // Count user-perceived characters, so emoji and combining marks do not
        // receive extra time merely because they occupy more UTF-16 code units.
        let fraction = Double(text.distance(from: text.startIndex, to: boundary)) / Double(text.count)
        return cue.startsAtMs + Int((Double(cue.endsAtMs - cue.startsAtMs) * fraction).rounded())
    }
}

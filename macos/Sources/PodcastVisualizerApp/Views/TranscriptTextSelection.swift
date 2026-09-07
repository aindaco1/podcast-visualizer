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
}

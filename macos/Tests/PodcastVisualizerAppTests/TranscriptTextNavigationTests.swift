import AppKit
import AVFoundation
import PodcastVisualizerCore
import SwiftUI
import Testing
@testable import PodcastVisualizerApp

@Suite("Transcript text navigation", .serialized)
@MainActor
struct TranscriptTextNavigationTests {
    private static var retainedWindows: [NSWindow] = []

    private final class NoopUpdateChecker: UpdateChecking {
        let canCheckForUpdates = true
        func checkForUpdates() {}
    }

    private func cue(_ text: String = "First cue.") -> ReviewCue {
        ReviewCue(id: "cue_000001", startsAtMs: 1_000, endsAtMs: 3_000,
                  textMarkdown: text, speakerLabel: "speaker-01", speakerConfirmed: true,
                  speakerConfidence: 1, speakerAmbiguous: false)
    }

    private func selection(_ offset: Int, in text: String) -> TranscriptTextSelection {
        var result = TranscriptTextSelection()
        let index = text.index(text.startIndex, offsetBy: offset)
        result.set(TextSelection(insertionPoint: index), in: text)
        return result
    }

    private func load(_ store: TranscriptReviewStore, cue: ReviewCue) {
        store.load(ReviewWorkspace(
            projectRoot: "/synthetic", draftManifestSha256: String(repeating: "a", count: 64),
            audioPath: "/synthetic/missing.wav", durationMs: 4_000,
            speakers: [ReviewSpeaker(id: "speaker-01", displayName: "Host")],
            cues: [cue], checkedCueIds: [cue.id], hasWorkingCopy: true
        ))
    }

    private func loadSilentAudio(_ store: TranscriptReviewStore) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("transcript-navigation-\(UUID().uuidString).wav")
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 8_000, channels: 1))
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 32_000))
        buffer.frameLength = buffer.frameCapacity
        let samples = try #require(buffer.floatChannelData?[0])
        samples.initialize(repeating: 0, count: Int(buffer.frameLength))
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
        }
        store.audioPlayer.load(url)
        #expect(store.audioPlayer.duration == 4)
        return url
    }

    @Test("cue-relative estimates are bounded and count visible Unicode characters")
    func estimatedPositions() {
        for text in ["First cue.", "Cafe\u{301} 🎧 cue.", "A 👩🏽‍💻 B", "first\nsecond", "漢字の字幕"] {
            let source = cue(text)
            #expect(selection(0, in: text).estimatedPlayheadMs(in: source) == 1_000)
            #expect(selection(text.count, in: text).estimatedPlayheadMs(in: source) == 3_000)
            for index in 0...text.count {
                let expected = 1_000 + Int((2_000 * Double(index) / Double(text.count)).rounded())
                #expect(selection(index, in: text).estimatedPlayheadMs(in: source) == expected)
            }
        }
        #expect(TranscriptTextSelection().estimatedPlayheadMs(in: cue()) == nil)
        #expect(selection(0, in: "").estimatedPlayheadMs(in: cue("")) == nil)
        var range = TranscriptTextSelection()
        let text = "First cue."
        range.set(TextSelection(range: text.startIndex..<text.endIndex), in: text)
        #expect(range.estimatedPlayheadMs(in: cue(text)) == nil)
        var longCue = cue("ab")
        longCue.endsAtMs = Int.max
        #expect(selection(2, in: "ab").estimatedPlayheadMs(in: longCue) == Int.max)
    }

    @Test("click navigation pauses and positions audio without dirtying the working copy")
    func navigateAndSplit() throws {
        let store = TranscriptReviewStore()
        let source = cue()
        load(store, cue: source)
        let audio = try loadSilentAudio(store)
        defer { store.audioPlayer.stop(); try? FileManager.default.removeItem(at: audio) }
        let before = store.editPayload()
        let caret = selection(5, in: source.textMarkdown)
        store.audioPlayer.togglePlayback()
        #expect(store.audioPlayer.isPlaying)
        store.seekToText(in: source, selection: caret)
        #expect(!store.audioPlayer.isPlaying)
        #expect(abs(store.audioPlayer.currentTime - 2) < 0.002)
        #expect(store.editPayload() == before)
        #expect(!store.isDirty)
        #expect(store.isChecked(source.id))
        #expect(store.statusMessage.contains("estimated"))
        #expect(store.statusMessage.contains("fine-tune"))

        // The split uses the real player position; a transport adjustment wins
        // over the initial text estimate.
        store.audioPlayer.seek(to: 2.2)
        store.splitCue(cueID: source.id,
                       textBoundaryUTF16Offset: caret.insertionOffset(in: source.textMarkdown),
                       undoManager: nil)
        #expect(store.cues.map(\.textMarkdown) == ["First", "cue."])
        #expect(store.cues.first?.endsAtMs == 2_200)
        #expect(store.cues.last?.startsAtMs == 2_200)
    }

    @Test("stale, selected, and removed text never repositions audio")
    func staleOrSelectedText() throws {
        let store = TranscriptReviewStore()
        let source = cue("Cafe\u{301} 🎧 cue.")
        load(store, cue: source)
        let audio = try loadSilentAudio(store)
        defer { store.audioPlayer.stop(); try? FileManager.default.removeItem(at: audio) }
        store.audioPlayer.seek(to: 0.5)
        let caret = selection(5, in: source.textMarkdown)
        var range = TranscriptTextSelection()
        range.set(TextSelection(range: source.textMarkdown.startIndex..<source.textMarkdown.endIndex),
                  in: source.textMarkdown)
        store.seekToText(in: source, selection: range)
        #expect(store.audioPlayer.currentTime == 0.5)
        #expect(caret.estimatedPlayheadMs(in: cue("Café 🎧 cue.")) == nil)
        var retimedSource = source
        retimedSource.endsAtMs += 100
        store.seekToText(in: retimedSource, selection: caret)
        #expect(store.audioPlayer.currentTime == 0.5)
        store.setText("Short", for: source.id)
        store.seekToText(in: source, selection: caret)
        #expect(store.audioPlayer.currentTime == 0.5)
        store.markApproved()
        store.seekToText(in: source, selection: caret)
        #expect(store.statusMessage == "Transcript approved")
    }

    @Test("missing preview audio explains recovery and preserves edits")
    func unavailableAudio() {
        let store = TranscriptReviewStore()
        let source = cue()
        load(store, cue: source)
        let before = store.editPayload()
        store.seekToText(in: source, selection: selection(5, in: source.textMarkdown))
        #expect(store.editPayload() == before)
        #expect(!store.isDirty)
        #expect(store.statusMessage.contains("Save your edits, then reopen this project"))
        #expect(store.statusMessage.contains("all transcript edits were preserved"))
    }

    @Test("rendered editor click observer seeks while typing and Find selections leave audio alone")
    func renderedClick() async throws {
        _ = NSApplication.shared
        let appStore = AppStore(
            client: DemoCLIClient(),
            commands: try CLICommandBuilder(executable: URL(fileURLWithPath: "/usr/bin/false")),
            updateChecker: NoopUpdateChecker(), brand: nil
        )
        let store = appStore.transcriptReview
        let source = cue()
        load(store, cue: source)
        let audio = try loadSilentAudio(store)
        defer { store.audioPlayer.stop(); try? FileManager.default.removeItem(at: audio) }
        let host = NSHostingView(rootView: TranscriptReviewView(
            appStore: appStore, review: store, columnVisibility: .constant(.detailOnly)
        ))
        host.sizingOptions = []
        host.frame = NSRect(x: 0, y: 0, width: 1_600, height: 780)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1_600, height: 780),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.contentView = host
        window.setFrameOrigin(NSPoint(x: 100, y: 100))
        window.orderBack(nil)
        Self.retainedWindows.append(window)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(150))
        host.layoutSubtreeIfNeeded()
        func editors(in view: NSView) -> [NSTextView] {
            (view as? NSTextView).map { [$0] } ?? view.subviews.flatMap { editors(in: $0) }
        }
        let editor = try #require(editors(in: host).first { $0.string == source.textMarkdown })
        window.makeFirstResponder(editor)
        let screenRect = editor.firstRect(forCharacterRange: NSRange(location: 5, length: 0), actualRange: nil)
        let lineStart = editor.firstRect(forCharacterRange: NSRange(location: 0, length: 0), actualRange: nil)
        // Use the single-line fixture's local glyph position. Offscreen test
        // windows can be relocated by macOS between screen-coordinate reads.
        let point = editor.convert(NSPoint(
            x: editor.textContainerOrigin.x + (editor.textContainer?.lineFragmentPadding ?? 0)
                + screenRect.minX - lineStart.minX,
            y: editor.textContainerOrigin.y + screenRect.height / 2
        ), to: nil)
        func observers(in view: NSView) -> [TranscriptCaretClickObserver.ClickView] {
            (view as? TranscriptCaretClickObserver.ClickView).map { [$0] }
                ?? view.subviews.flatMap { observers(in: $0) }
        }
        let observer = try #require(observers(in: host).first)
        let uptime = ProcessInfo.processInfo.systemUptime
        let down = try #require(NSEvent.mouseEvent(with: .leftMouseDown, location: point,
            modifierFlags: [], timestamp: uptime, windowNumber: window.windowNumber,
            context: nil, eventNumber: 1, clickCount: 1, pressure: 1))
        let up = try #require(NSEvent.mouseEvent(with: .leftMouseUp, location: point,
            modifierFlags: [], timestamp: uptime + 0.05, windowNumber: window.windowNumber,
            context: nil, eventNumber: 2, clickCount: 1, pressure: 0))
        observer.observe(down)
        editor.setSelectedRange(NSRange(location: 5, length: 0))
        // NSTextView consumes mouse-up internally. The observer must finish
        // without receiving it from NSApplication's local event monitor.
        try await Task.sleep(for: .milliseconds(150))
        #expect(editor.selectedRange() == NSRange(location: 5, length: 0))
        #expect(abs(store.audioPlayer.currentTime - 2) < 0.002)
        #expect(!store.isDirty)

        // A click at the same caret still works after a transport adjustment.
        store.audioPlayer.seek(to: 0.5)
        observer.observe(down)
        observer.observe(up)
        try await Task.sleep(for: .milliseconds(30))
        #expect(abs(store.audioPlayer.currentTime - 2) < 0.002)

        // Dragging, range selections, and clicks outside this exact editor
        // must not override playback or the manually adjusted playhead.
        store.audioPlayer.seek(to: 0.5)
        let drag = try #require(NSEvent.mouseEvent(with: .leftMouseDragged, location: point,
            modifierFlags: [], timestamp: uptime + 0.02, windowNumber: window.windowNumber,
            context: nil, eventNumber: 3, clickCount: 1, pressure: 1))
        observer.observe(down)
        observer.observe(drag)
        observer.observe(up)
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.audioPlayer.currentTime == 0.5)
        observer.observe(down)
        editor.setSelectedRange(NSRange(location: 0, length: 5))
        observer.observe(up)
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.audioPlayer.currentTime == 0.5)
        editor.setSelectedRange(NSRange(location: 5, length: 0))
        let outside = observer.convert(NSPoint(x: observer.bounds.maxX + 10, y: 10), to: nil)
        let outsideDown = try #require(NSEvent.mouseEvent(with: .leftMouseDown, location: outside,
            modifierFlags: [], timestamp: uptime, windowNumber: window.windowNumber,
            context: nil, eventNumber: 4, clickCount: 1, pressure: 1))
        observer.observe(outsideDown)
        observer.observe(up)
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.audioPlayer.currentTime == 0.5)

        for (count, modifiers) in [(2, NSEvent.ModifierFlags()), (1, NSEvent.ModifierFlags.shift)] {
            let modifiedDown = try #require(NSEvent.mouseEvent(with: .leftMouseDown, location: point,
                modifierFlags: modifiers, timestamp: uptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 5, clickCount: count, pressure: 1))
            observer.observe(modifiedDown)
            observer.observe(up)
            try await Task.sleep(for: .milliseconds(30))
            #expect(store.audioPlayer.currentTime == 0.5)
        }

        // Removing the observer cancels an already deferred click.
        observer.observe(down)
        observer.observe(up)
        observer.stopObserving()
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.audioPlayer.currentTime == 0.5)

        store.audioPlayer.seek(to: 0.5)
        editor.insertText("X", replacementRange: editor.selectedRange())
        try await Task.sleep(for: .milliseconds(50))
        #expect(store.cues.first?.textMarkdown == "FirstX cue.")
        #expect(store.audioPlayer.currentTime == 0.5)
        store.findText = "cue"
        try await Task.sleep(for: .milliseconds(50))
        #expect(store.currentMatch != nil)
        #expect(store.audioPlayer.currentTime == 0.5)
    }
}

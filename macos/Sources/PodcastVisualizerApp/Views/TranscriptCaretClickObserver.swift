import AppKit
import SwiftUI

/// Observe native mouse clicks without replacing TextEditor or intercepting its
/// editing gestures. Selection changes alone cannot distinguish typing from a click.
struct TranscriptCaretClickObserver: NSViewRepresentable {
    let text: String
    let onClick: @MainActor (Int) -> Void

    func makeNSView(context: Context) -> ClickView { ClickView() }

    func updateNSView(_ view: ClickView, context: Context) {
        view.text = text
        view.onClick = onClick
    }

    static func dismantleNSView(_ view: ClickView, coordinator: ()) {
        view.stopObserving()
    }

    final class ClickView: NSView {
        var text = ""
        var onClick: @MainActor (Int) -> Void = { _ in }
        private var monitor: Any?
        private var clickStarted = false
        private var observationGeneration = 0

        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stopObserving()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(
                matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
            ) { [weak self] event in
                MainActor.assumeIsolated { self?.observe(event) }
                return event
            }
        }

        func stopObserving() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
            clickStarted = false
            observationGeneration += 1
        }

        func observe(_ event: NSEvent) {
            let isInside = event.window === window && window != nil
                && bounds.intersection(visibleRect).contains(convert(event.locationInWindow, from: nil))
            switch event.type {
            case .leftMouseDown:
                clickStarted = isInside && event.clickCount == 1
                    && event.modifierFlags.intersection([.shift, .command, .option, .control]).isEmpty
                if clickStarted { finishClickAfterTextTracking() }
            case .leftMouseDragged:
                clickStarted = false
            case .leftMouseUp:
                if !isInside { clickStarted = false }
            default:
                break
            }
        }

        private func finishClickAfterTextTracking() {
            let clickedText = text
            let clickedWindow = window
            let clickedGeneration = observationGeneration
            let onCaretClick = onClick
            // NSTextView consumes mouse-up in its tracking loop. Wait for
            // default mode instead of requiring that event to be dispatched
            // through NSApplication or running during text drag tracking.
            RunLoop.main.perform(inModes: [.default]) { [weak self, weak clickedWindow] in
                MainActor.assumeIsolated {
                    guard let self, let clickedWindow, self.window === clickedWindow,
                          self.observationGeneration == clickedGeneration,
                          self.clickStarted,
                          self.text.utf8.elementsEqual(clickedText.utf8),
                          let editor = clickedWindow.firstResponder as? NSTextView,
                          editor.string.utf8.elementsEqual(clickedText.utf8),
                          self.bounds.intersects(self.convert(editor.bounds, from: editor)),
                          editor.selectedRanges.count == 1
                    else { return }
                    self.clickStarted = false
                    let range = editor.selectedRange()
                    guard range.length == 0, range.location != NSNotFound else { return }
                    onCaretClick(range.location)
                }
            }
        }
    }
}

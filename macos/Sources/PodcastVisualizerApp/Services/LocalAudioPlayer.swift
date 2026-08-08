import AVFoundation
import Foundation
import Observation

@MainActor
@Observable
final class LocalAudioPlayer {
    private(set) var isPlaying = false
    private(set) var currentTime: TimeInterval = 0
    private(set) var duration: TimeInterval = 0
    private(set) var errorMessage: String?

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var ticker: Task<Void, Never>?

    func load(_ url: URL) {
        stop()
        errorMessage = nil
        do {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard url.isFileURL, values.isRegularFile == true, values.isSymbolicLink != true else {
                throw CocoaError(.fileReadInvalidFileName)
            }
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            self.player = player
            duration = player.duration
            currentTime = 0
        } catch {
            player = nil
            duration = 0
            currentTime = 0
            errorMessage = "Audio preview could not be loaded. Transcript editing is still available."
        }
    }

    func togglePlayback() {
        guard let player else { return }
        if player.isPlaying {
            player.pause()
            isPlaying = false
            ticker?.cancel()
        } else {
            if player.currentTime >= player.duration { player.currentTime = 0 }
            guard player.play() else {
                errorMessage = "Audio playback could not start."
                return
            }
            isPlaying = true
            startTicker()
        }
        currentTime = player.currentTime
    }

    func seek(to seconds: TimeInterval, play: Bool = false) {
        guard let player else { return }
        player.currentTime = min(player.duration, max(0, seconds))
        currentTime = player.currentTime
        if play, !player.isPlaying { togglePlayback() }
    }

    func stop() {
        ticker?.cancel()
        ticker = nil
        player?.stop()
        player = nil
        isPlaying = false
        currentTime = 0
        duration = 0
    }

    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, let player = self.player else { return }
                self.currentTime = player.currentTime
                self.isPlaying = player.isPlaying
                if !player.isPlaying { return }
            }
        }
    }
}

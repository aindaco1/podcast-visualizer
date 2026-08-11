# Podcast Visualizer roadmap

This roadmap records intended direction, not a promised release date. Existing
projects, scenes, and renders remain immutable as these items are developed.

## Next: bottom audio waveform

Add a simple waveform that moves with the podcast audio along the bottom of the
rendered frame.

Acceptance criteria:

- derive the waveform locally from the project-owned canonical audio;
- project deterministic, bounded amplitude samples onto the existing 24 fps
  render timeline so the visual remains synchronized for the full episode;
- keep it inside aspect-specific bottom safe margins and visually separate from
  the centered transcript and persistent brand mark;
- use restrained Dust Wave colors and smoothing without obscuring dialogue;
- support opaque H.264, compact HEVC alpha, and ProRes 4444 alpha outputs;
- stream the visual into the existing FFmpeg render without image-sequence
  intermediates or unbounded per-frame memory;
- hash the analyzer settings and audio-feature timeline into scene/render
  evidence so rerenders are deterministic and prior outputs are never replaced;
- add silence, impulse, sustained speech, A/V drift, safe-area, alpha, and
  full-episode performance regression tests before release.

This is an audio-synchronized render element, not microphone capture or a
network service. Podcast media and analysis remain on the Mac.

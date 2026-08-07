# Podcast Visualizer

Local-first Apple Silicon CLI for turning reviewed, speaker-aware podcast transcripts into Dust Wave/ASCII videos.

The current release candidate is `0.1.0-rc.1`. The approved architecture and acceptance gates are in [docs/implementation-plan.md](docs/implementation-plan.md); release evidence is tracked in [docs/release-checklist.md](docs/release-checklist.md).

## Release-candidate quick start

The archive targets Apple Silicon and macOS 26. It bundles Node, FFmpeg,
CPython, WhisperX, the Swift speech sidecar, the anonymous diarization model,
fonts, and browser review assets. Parakeet and English alignment weights stay
external and are hash-verified before use.

From the extracted archive, explicitly fetch the pinned English alignment
weights (about 378 MB), then import an existing Parakeet v3 Core ML directory.
Imports copy only files accepted by the pinned verifier, reject symlinks, and
never replace an unverified installation:

```bash
./runtime/macos-arm64/bin/node ./scripts/fetch-alignment-model.mjs
./bin/dustwave-video models import parakeet-v3 --source /absolute/parakeet-tdt-0.6b-v3
./bin/dustwave-video models status
./bin/dustwave-video doctor
```

If the pinned English alignment model is already present elsewhere, import it
without network access instead:

```bash
./bin/dustwave-video models import align-en --source /absolute/whisperx-en
```

After import, `analyze` uses the verified default Parakeet installation. An
explicit `--parakeet-model` or `PODCAST_VISUALIZER_PARAKEET_MODEL` remains
available for development:

```bash
./bin/dustwave-video init --source /absolute/episode.m4a --project /absolute/proof --clip 00:00:00-00:01:30
./bin/dustwave-video prepare --project /absolute/proof
./bin/dustwave-video analyze --project /absolute/proof
./bin/dustwave-video review --project /absolute/proof
./bin/dustwave-video align --project /absolute/proof
./bin/dustwave-video render --project /absolute/proof --aspect all
```

Review is a hard gate. The renderer will not accept a draft or an approved
revision with unconfirmed/unknown speaker assignments.

Approved transcripts and forced alignment retain vocalized pauses such as
`uh` and `um` so acoustic timing stays faithful. The versioned visual-word
policy suppresses only those conservative filler tokens and holds the previous
displayed word until the next displayed word begins; it never rewrites the
approved transcript.

## Development

Requirements for contributors are Node 22+ and Git. Release users will receive bundled runtimes and sidecars.

```bash
npm test
npm run check
node bin/dustwave-video.mjs --help
```

Create a project from a local media file:

```bash
node bin/dustwave-video.mjs init \
  --source /absolute/path/to/episode.m4a \
  --project /absolute/path/to/episode-proof \
  --clip 00:01:58-00:03:25
```

The product intentionally does not download YouTube URLs. Development fixtures must be acquired separately and must not be committed unless their rights explicitly permit redistribution.

# Podcast Visualizer

Local-first Apple Silicon CLI for turning reviewed, speaker-aware podcast transcripts into Dust Wave/ASCII videos.

The current release candidate is `0.1.0-rc.3`. The approved architecture and acceptance gates are in [docs/implementation-plan.md](docs/implementation-plan.md); release evidence is tracked in [docs/release-checklist.md](docs/release-checklist.md). Editor and operating-system support for transparent outputs is documented in [docs/editor-compatibility.md](docs/editor-compatibility.md). The next application release is planned in [docs/macos-app-rc-plan.md](docs/macos-app-rc-plan.md).

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
./bin/dustwave-video render --project /absolute/proof --aspect all --background both
```

`--background opaque` is the default and writes an H.264/AAC MP4. Use
`--background transparent` for a compact HEVC-with-alpha/AAC MOV, or
`--background both` to create both variants for every selected aspect. Alpha
MOVs retain synchronized podcast audio. The compact default matches the proven
Apple VideoToolbox pattern used by `pool-marketing-docs`; decoded alpha is
verified through AVFoundation instead of inferred from FFprobe metadata.

HEVC alpha is dramatically smaller and works well in Apple's media stack. For
an editor that does not support Apple's auxiliary alpha layer, request the much
larger but broadly interoperable ProRes 4444/24-bit PCM profile:

```bash
./bin/dustwave-video render --project /absolute/proof --aspect all \
  --background transparent --alpha-codec prores
```

Use `--alpha-codec both` only when both delivery tiers are intentionally
required. With `--background both`, the CLI renders one opaque MP4 plus both
transparent MOV profiles for each selected aspect without duplicating the
opaque render:

```bash
./bin/dustwave-video render --project /absolute/proof --aspect 16:9 \
  --background both --alpha-codec both
```

New transparent outputs identify their codec in the filename as
`-transparent-hevc.mov` or `-transparent-prores.mov`. Previously verified
immutable renders keep their original filenames and remain reusable through
their manifests.

### Transparent-editor compatibility

HEVC support alone does not prove alpha support. Apple's format stores the
color image and auxiliary alpha data as two layers inside one `hvc1` video
track; a decoder that does not understand the alpha layer is allowed to ignore
it and show only the opaque color layer. The practical policy is therefore:

| Target | Compact HEVC alpha MOV | Additional setup | Recommended output |
|---|---|---|---|
| Procreate Dreams 2+ | Explicit import/export support | Current app and iPadOS; no codec plug-in | HEVC alpha |
| DaVinci Resolve 20/21 on macOS | Supported by the latest detailed Blackmagic codec matrix | No codec installation; qualify the installed version once | HEVC alpha, with ProRes fallback |
| DaVinci Resolve on Windows/Linux | Alpha support is not documented for H.265 MOV | HEVC or Studio components do not guarantee auxiliary-alpha handling | ProRes 4444 |
| Adobe Premiere Pro / After Effects | Ordinary HEVC MOV import is documented; Apple auxiliary alpha is not | A licensed current Adobe install enables normal HEVC, but no documented add-on guarantees this alpha profile | ProRes 4444 |
| Standard Procreate | Imports video as per-frame artwork layers and may truncate long clips | No useful codec installation path | Use Procreate Dreams |

Primary references: [Apple HEVC Video with Alpha](https://developer.apple.com/videos/play/wwdc2019/506/), [Procreate Dreams content types](https://help.procreate.com/dreams/handbook/tracks-and-content/content-types), [DaVinci Resolve 20 codec matrix](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_Supported_Codec_List.pdf), [After Effects supported formats](https://helpx.adobe.com/after-effects/desktop/get-started/supported-file-formats/supported-file-formats.html), and [Adobe Media Encoder supported exports](https://helpx.adobe.com/media-encoder/desktop/encoding-quick-start-and-basics/file-formats-supported-export.html).

Before a full handoff, import a representative output over a contrasting solid
background and verify transparent regions, soft edges, duration, and audio
sync. See the compatibility document for the complete qualification procedure
and the evidence date.

Transparent MP4 is not offered because it is not a dependable interchange
format.

Review is a hard gate. The renderer will not accept a draft or an approved
revision with unconfirmed/unknown speaker assignments.

Approved transcripts and forced alignment retain vocalized pauses such as
`uh` and `um` so acoustic timing stays faithful. The versioned visual-word
policy suppresses only those conservative filler tokens and holds the previous
displayed word until the next displayed word begins; it never rewrites the
approved transcript.

The default `dust-subtle` style uses reference-scale Inter Light transcript
type, IBM Plex Mono Dust Wave labels, cyan/magenta signal accents, a persistent
Dust Wave bug, and a deterministic moving ASCII dust field. Speaker identity
remains anonymous and is expressed only through the reviewed speaker palette.
Use `--style transcript-only` when a diagnostic text-only render is preferable.

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

## Native macOS app roadmap

The planned `0.2.0-rc.1` release adds a very small SwiftUI app around this
same CLI. It will import local audio, drive the existing review-gated pipeline,
render any aspect/output combination, and export verified files. Swift will
remain a presentation and process-orchestration layer; it will not duplicate
transcription, alignment, scene, codec, or QC policy.

Distribution will follow the security-reviewed Record pattern: Developer ID
signing, hardened runtime, Apple notarization and stapling, plus Sparkle 2 for
an explicit **Check for Updates…** command. Automatic/background checks stay
off, the main app gets no general network entitlement, and Sparkle accepts only
the signed appcast and update archive published by this repository's public
[GitHub Releases feed](https://github.com/aindaco1/podcast-visualizer/releases).
The private signing material remains outside Git in the existing Apple Auth
directory and protected GitHub release environment. See the
[macOS app release-candidate plan](docs/macos-app-rc-plan.md) for architecture,
security boundaries, implementation slices, tests, and release gates.

## License

Podcast Visualizer is open source under the [MIT License](LICENSE). Bundled and
shared third-party components retain their respective licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.

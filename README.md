# Podcast Visualizer

Local-first Apple Silicon macOS app for turning reviewed, speaker-aware podcast transcripts into Dust Wave/ASCII videos.

The current stable release is `1.0.3`. The app keeps media, transcripts,
review data, and model inputs on the Mac. Editor support for transparent
outputs is documented in [docs/editor-compatibility.md](docs/editor-compatibility.md),
and the native app's machine-readable CLI boundary is documented in
[docs/cli-app-contract.md](docs/cli-app-contract.md).

To resume implementation in a fresh Codex task, open this repository as the
task's project folder and follow [docs/codex-project-handoff.md](docs/codex-project-handoff.md).

## Install

Podcast Visualizer requires an Apple Silicon Mac running macOS 15 or later.
Download the notarized DMG from
[GitHub Releases](https://github.com/aindaco1/podcast-visualizer/releases/latest),
open it, and copy **Podcast Visualizer** to Applications. The app is signed
with a Developer ID certificate and notarized by Apple.

Updates are deliberately user initiated. Use **Check for Updates…** in the
top-right window toolbar to read the signed update feed on GitHub. Automatic and
background update checks are disabled, and Sparkle verifies the Ed25519
signature on every update archive before installation.

## Model setup

The app targets Apple Silicon and macOS 15+. It bundles Node, FFmpeg,
CPython, WhisperX, the Swift speech sidecar, the anonymous diarization model,
fonts, and browser review assets. Parakeet and English alignment weights stay
external and are hash-verified before use.

The app checks its app-owned model store and exact conventional model folders
under Downloads at launch. Verified local models are imported automatically,
but network downloads always require an explicit **Download** confirmation.
The Models card also keeps an **Import Existing…** fallback without displaying
the underlying search-path inventory.

Parakeet is about 483 MB and English alignment is about 378 MB. Downloads use
only the pinned FluidInference and PyTorch HTTPS sources, stream into bounded
staging directories with progress, verify exact sizes and SHA-256 digests,
pass the existing model verifier, and install atomically. Failed or cancelled
downloads do not replace an existing model. Podcast media and transcripts are
never uploaded.

Advanced users working from a source checkout can run the equivalent
development CLI. The signed app's helper executables intentionally inherit its
sandbox and must be launched by the app rather than directly from Terminal:

```bash
./runtime/macos-arm64/bin/node ./scripts/fetch-alignment-model.mjs
./bin/dustwave-video models download parakeet-v3
./bin/dustwave-video models download align-en
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
type, IBM Plex Mono labels, cyan/magenta signal accents, a persistent project
brand bug, and a deterministic moving ASCII dust field. Reviewed speaker
display names can appear above each transcript cue and may be hidden per project.
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
node bin/dustwave-video.mjs probe \
  --source /absolute/path/to/episode.m4a \
  --json

node bin/dustwave-video.mjs init \
  --source /absolute/path/to/episode.m4a \
  --project /absolute/path/to/episode-proof \
  --clip 00:01:58-00:03:25
```

Native clients pass `--json --progress-fd 3` and read the versioned bounded
NDJSON progress stream from that dedicated descriptor. JSON errors are written
to standard error; successful final JSON remains on standard output.

The product intentionally does not download YouTube URLs. Development fixtures must be acquired separately and must not be committed unless their rights explicitly permit redistribution.

## Native macOS app

The current `release/1.0.5` source provides a focused SwiftUI app around the same CLI. It can
create or reopen projects, drive the review-gated pipeline, edit long
transcripts in a separate tab, manage speakers, customize podcast branding,
render any aspect/output combination, and export verified files. Swift remains
a presentation and process-orchestration layer; it does not duplicate
transcription, alignment, scene, codec, or QC policy.

Distribution follows the security-reviewed Record pattern: Developer ID
signing, hardened runtime, Apple notarization and stapling, plus Sparkle 2 for
an explicit **Check for Updates…** toolbar action. Automatic/background checks stay
off. The main app's outbound client entitlement supports explicit, allowlisted
model downloads; the updater still accepts only the signed appcast and update
archive published by this repository's public
[GitHub Releases feed](https://github.com/aindaco1/podcast-visualizer/releases).
Private signing material remains outside Git and is available to automation
only through the protected GitHub `release` environment. See the
[release runbook](docs/release-runbook.md) for the release gates and published
evidence.

## License

Podcast Visualizer is open source under the [MIT License](LICENSE). Bundled and
shared third-party components retain their respective licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.

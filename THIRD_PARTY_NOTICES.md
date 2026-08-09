# Third-party notices

Podcast Visualizer includes or interoperates with the components below. Full
license texts shipped with the release take precedence over this summary. The
release SBOM contains the complete locked Python inventory.

## Bundled software

| Component | Version / revision | License | License location |
|---|---:|---|---|
| Node.js | 24.19.0 | Node.js contributors license | `runtime/macos-arm64/LICENSE.Node` |
| FFmpeg | 8.1.2 | LGPL-2.1-or-later | `runtime/macos-arm64/COPYING.LGPLv2.1` |
| CPython | 3.13.13 | Python Software Foundation License | `runtime/macos-arm64/alignment/LICENSE.Python` |
| WhisperX | 3.8.6 | BSD-2-Clause | bundled package metadata/license files |
| PyTorch | 2.8.0 | BSD-3-Clause | bundled package metadata/license files |
| FluidAudio | 0.15.5 (`19600a485baa4998812e4654b70d2bab8f2c9949`) | Apache-2.0 | `licenses/speech/Apache-2.0-FluidAudio.txt` |
| RecordSpeech | `33f8996b4c059637aefbeb49ea2411cdfad816d2` | MIT | `licenses/shared/RecordSpeech-MIT.txt` |
| Dust Wave timed-text | `a0006c3e0c3f8ab814387491753989956adbbe94` | MIT | `licenses/shared/dust-wave-platform-MIT.txt` |
| Dust Wave alignment runner | `32111c2a8dd62d891c4309f7638a86c31a789dc3` | MIT | `licenses/shared/alignment-runner-MIT.txt` |
| Inter | Google Fonts revision `c28e08582e7bd36751febb3391142a5eb18bbb34` | SIL OFL 1.1 | `licenses/fonts/OFL-Inter.txt` |
| IBM Plex Mono | Google Fonts revision `c28e08582e7bd36751febb3391142a5eb18bbb34` | SIL OFL 1.1 | `licenses/fonts/OFL-IBM-Plex-Mono.txt` |
| Sparkle | 2.9.5 (`79bc9e872948e47877e76f194cb0c8e0412b0b90`) | MIT | `Contents/Resources/Licenses/Sparkle.txt` |
| FluidAudio fastcluster-derived code | FluidAudio revision above | BSD-style | `licenses/speech/fastcluster-LICENSE.md` |
| FluidAudio VBx-derived code | FluidAudio revision above | Apache-2.0 | `licenses/speech/vbx-LICENSE.md` |

The Swift dependency closure also retains the notices for Swift Argument
Parser and Sparkle in `licenses/speech/`. They are included conservatively even
where the linker may have stripped unused implementation code.

FFmpeg is configured without GPL or nonfree code, with network protocols
disabled, and dynamically links its bundled LGPL-compatible text-rendering
dependency closure. Build flags and exact binary hashes are recorded in
`runtime/macos-arm64/manifest.json`.

## Bundled model

The anonymous speaker-diarization Core ML model is from
`FluidInference/speaker-diarization-coreml` revision
`1ed7a662fdc7109e36d822db793ee6eebdaf8594` under CC-BY-4.0. Its license,
README, file hashes, and source manifest ship beside the model in
`runtime/macos-arm64/models/speaker-diarization/`.

The NLTK `punkt_tab` tokenizer data is shipped at the exact upstream SHA-256
recorded in `runtime/macos-arm64/alignment-manifest.json`. The upstream NLTK
data index does not declare a separate license for that data package; review
this provenance before redistributing the release outside the project team.

## External model weights

Parakeet TDT v3 and the English Wav2Vec2 alignment weights are intentionally
not included in the release archive. The application accepts only the pinned
file manifests and rejects substitutions. Users remain responsible for the
terms governing model weights they import or explicitly download.

The Parakeet checkpoint is the Core ML conversion published as
`FluidInference/parakeet-tdt-0.6b-v3-coreml` at immutable revision
`aed02740059203c4a87495924f685de3722ae9ce`. Its model card declares the
CC-BY-4.0 license. The app displays that source and license before downloading
and accepts only the 17 pinned file hashes shared with the offline verifier.

The English alignment checkpoint is the fairseq
`WAV2VEC2_ASR_BASE_960H` model distributed through Torchaudio. Its pinned URL,
size, and SHA-256 are in `resources/model-manifests/whisperx-en.json`; fairseq
code and pretrained models are distributed under MIT terms.

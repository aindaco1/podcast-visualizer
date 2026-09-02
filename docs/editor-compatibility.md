# Transparent video compatibility

Status: adopted 2026-08-07 and reverified against current vendor documentation
on 2026-09-02.

Podcast Visualizer produces two transparent MOV delivery tiers. The compact
tier is the default; the editorial tier is intentionally opt-in because it is
much larger.

| Tier | Video | Audio | Intended use |
|---|---|---|---|
| Compact | Apple HEVC with auxiliary alpha, `hvc1`, VideoToolbox | AAC-LC, 48 kHz stereo, 192 kbps | Apple-native playback and compatible editors |
| Editorial | Apple ProRes 4444, `ap4h`, straight alpha | 24-bit PCM, 48 kHz stereo | Broad professional-editor interchange |

Transparent H.264 MP4 is not offered. Generic FFmpeg and FFprobe can decode or
describe the compact file's base HEVC layer without exposing its auxiliary
alpha layer, so the renderer validates compact alpha through AVFoundation and
then measures the decoded alpha plane.

## Why ordinary HEVC support is insufficient

Apple's interoperability profile stores the color image and alpha image as two
layers in one HEVC video track whose codec type is `hvc1`. A decoder that does
not implement the auxiliary-alpha profile is expected to ignore the alpha
layer and display the base layer. A successful import can therefore still be
an alpha failure.

Primary references:

- [Apple: HEVC Video with Alpha](https://developer.apple.com/videos/play/wwdc2019/506/)
- [Apple: HEVC Video with Alpha interoperability profile](https://developer.apple.com/av-foundation/HEVC-Video-with-Alpha-Interoperability-Profile.pdf)

Apple has provided playback support through AVFoundation since iOS 13,
tvOS 13, and macOS Catalina. Current Apple systems need no third-party codec
installation for the profile.

## Application matrix

### Procreate Dreams 2 and later

Supported. Procreate Dreams explicitly lists HEVC/H.265 MOV and ProRes 4444
MOV with alpha for import and export. Use a current Dreams release and iPadOS;
no codec plug-in is required.

- [Procreate Dreams: content types](https://help.procreate.com/dreams/handbook/tracks-and-content/content-types)
- [Procreate Dreams 2: transparent video import and export](https://help.procreate.com/articles/8AzGf-procreate-dreams-2-update-at-a-glance)

Standard Procreate is not an equivalent target. It converts imported video
frames into artwork layers and may omit later frames when the device's layer
limit is reached. Its documentation does not promise auxiliary-alpha handling.

- [Procreate: importing video](https://help.procreate.com/articles/zynnkd-how-to-import-video)

### DaVinci Resolve

Blackmagic's latest separately published detailed matrix is for Resolve 20.
Its macOS H.265/MOV row marks alpha exports, decoding, and encoding as
supported. The corresponding Windows and Rocky Linux H.265 rows do not mark
alpha support. Resolve 21 is the current application generation, but a separate
Resolve 21 codec matrix was not available at the 2026-09-02 verification date.

- [DaVinci Resolve 20 supported formats and codecs](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_Supported_Codec_List.pdf)
- [Blackmagic current support downloads](https://www.blackmagicdesign.com/support/)

Policy:

- Prefer compact HEVC alpha for a qualified Resolve installation on macOS.
- Run the import qualification below once for the installed Resolve version.
- Use ProRes 4444 on Windows or Linux, or whenever the Mac qualification fails.
- Resolve Studio or an operating-system HEVC component may add profiles and
  acceleration, but neither should be treated as proof of auxiliary-alpha
  handling on a platform whose matrix does not list it.

### Adobe Premiere Pro, After Effects, and Media Encoder

Adobe documents H.265 footage in a QuickTime MOV container as an After Effects
import format and documents ordinary HEVC export in Media Encoder. It does not
specifically identify Apple's auxiliary-alpha profile in either table. Media
Encoder lists ProRes 4444 separately as a QuickTime codec.

- [After Effects supported formats](https://helpx.adobe.com/after-effects/desktop/get-started/supported-file-formats/supported-file-formats.html)
- [Adobe Media Encoder supported exports](https://helpx.adobe.com/media-encoder/desktop/encoding-quick-start-and-basics/file-formats-supported-export.html)

Policy:

- Treat compact HEVC alpha in Adobe as unqualified, even when the MOV imports.
- Use a current licensed installation; Adobe excludes normal HEVC support from
  Premiere Pro and After Effects trials.
- A Windows HEVC extension or third-party decoder may make the base layer
  decodable but does not establish that Adobe exposes the auxiliary alpha.
- Use ProRes 4444 for a dependable Adobe handoff.

## Rendering the tiers

Compact only, all aspects:

```bash
./bin/dustwave-video render --project /absolute/proof --aspect all \
  --background transparent --alpha-codec hevc
```

Editorial compatibility output for one requested aspect:

```bash
./bin/dustwave-video render --project /absolute/proof --aspect 16:9 \
  --background transparent --alpha-codec prores
```

Both alpha tiers plus the opaque publication output:

```bash
./bin/dustwave-video render --project /absolute/proof --aspect 16:9 \
  --background both --alpha-codec both
```

The last command deliberately produces three outputs for the selected aspect:
one opaque H.264 MP4, one compact HEVC-alpha MOV, and one editorial ProRes
4444 MOV. It never duplicates the opaque render.

## Import qualification

Qualify each editor version before transferring a full episode:

1. Import a representative transparent output containing title, transcript,
   speaker-color, ASCII, and silent/held-word moments.
2. Place a saturated solid color below it in the editor timeline.
3. Confirm that nominally transparent regions reveal the lower layer instead
   of showing black or opaque base-layer pixels.
4. Inspect antialiased text and ASCII edges at 200% for black or light halos.
5. Confirm duration, frame rate, aspect, and synchronized audio.
6. Export a short composite and inspect it outside the editor.
7. Record the application, version, operating system, hardware, pass/fail, and
   selected delivery tier with the project handoff.

An opaque import, missing checkerboard transparency, or disabled alpha
interpretation means the compact profile failed qualification. Do not attempt
to repair that handoff with a generic codec pack; render the ProRes 4444 tier.

## Storage policy

Keep compact HEVC-alpha outputs by default. Generate ProRes 4444 only for the
aspect ratios and editor handoffs that require it. Both files remain immutable
and content-addressed after verification; an existing output is never silently
replaced or transcoded in place.

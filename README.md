# Podcast Visualizer

Local-first Apple Silicon CLI for turning reviewed, speaker-aware podcast transcripts into Dust Wave/ASCII videos.

The current implementation is under active development toward `0.1.0-rc.1`. The approved architecture and acceptance gates are in [docs/implementation-plan.md](docs/implementation-plan.md).

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


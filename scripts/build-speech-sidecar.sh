#!/bin/bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
tool_node="${PODCAST_VISUALIZER_RELEASE_TOOL_NODE:-node}"
swift build -c release --package-path "$project_root/speech-sidecar" \
  --product podcast-visualizer-speech --disable-automatic-resolution
binary="$project_root/speech-sidecar/.build/arm64-apple-macosx/release/podcast-visualizer-speech"
platform_revision="$(git -C "$project_root/shared/dust-wave-platform" rev-parse HEAD)"
swift_version="$(swift --version | head -1)"
"$tool_node" "$project_root/scripts/stage-speech-sidecar.mjs" \
  --binary "$binary" \
  --platform-revision "$platform_revision" \
  --swift-version "$swift_version"

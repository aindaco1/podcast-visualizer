#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
    echo "usage: $0 <absolute-output.tar.gz> <owner/repository> <commit> <run-id> <run-attempt>" >&2
    exit 64
fi
archive="$1"
repository="$2"
commit="$3"
run_id="$4"
run_attempt="$5"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
preparation_node="${PODCAST_VISUALIZER_RELEASE_TOOL_NODE:-}"

PODCAST_VISUALIZER_RELEASE_TOOL_NODE="$preparation_node" \
    "$repo_root/scripts/release/restore-pinned-runtime.sh" >/dev/null
PODCAST_VISUALIZER_RELEASE_TOOL_NODE="$repo_root/runtime/macos-arm64/bin/node" \
    "$repo_root/scripts/build-speech-sidecar.sh" >/dev/null
PODCAST_VISUALIZER_RELEASE_TOOL_NODE="$repo_root/runtime/macos-arm64/bin/node" \
    "$repo_root/scripts/release/validate-complete-runtime.sh" >/dev/null

release_root="$(dirname "$archive")/podcast-visualizer-ci-app-stage"
if [[ -e "$release_root" || -L "$release_root" ]]; then
    echo "refusing to replace CI app stage" >&2
    exit 1
fi
PODCAST_VISUALIZER_VERSION=0.0.0-dev \
PODCAST_VISUALIZER_BUILD_NUMBER=1 \
PODCAST_VISUALIZER_RELEASE_ROOT="$release_root" \
    "$repo_root/scripts/release/build-app.sh" >/dev/null
app_path="$release_root/Podcast Visualizer.app"
"$repo_root/scripts/release/validate-app-runtime.sh" "$app_path" >/dev/null
"$repo_root/scripts/release/package-ci-app.sh" \
    "$app_path" "$archive" "$repository" "$commit" "$run_id" "$run_attempt"

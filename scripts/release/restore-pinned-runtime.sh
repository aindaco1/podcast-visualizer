#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
tool_node_input="${PODCAST_VISUALIZER_RELEASE_TOOL_NODE:-}"
if [[ -z "$tool_node_input" ]]; then
    echo "PODCAST_VISUALIZER_RELEASE_TOOL_NODE must name the pinned preparation Node" >&2
    exit 64
fi
tool_node="$(command -v "$tool_node_input" 2>/dev/null || true)"
if [[ "$tool_node" != /* || ! -x "$tool_node" || -L "$tool_node" ]]; then
    echo "pinned preparation Node is missing or unsafe" >&2
    exit 1
fi
for command_name in gh shasum ditto; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "missing pinned-runtime restore command: $command_name" >&2
        exit 1
    fi
done

archive_name="podcast-visualizer-0.1.0-rc.3-macos-arm64.zip"
archive_sha256="9ca7c55c7083925a0bf387fbf2f52bc8e34ecfe749079f03c3a3e6eb8b8dadba"
release_name="podcast-visualizer-0.1.0-rc.3-macos-arm64"
work_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/podcast-visualizer-runtime-source.XXXXXX")"
cleanup() {
    /bin/rm -rf -- "$work_root"
}
trap cleanup EXIT
extraction_root="$work_root/extracted"
mkdir "$extraction_root"

gh release download v0.1.0-rc.3 \
    --repo "${GITHUB_REPOSITORY:-aindaco1/podcast-visualizer}" \
    --pattern "$archive_name" \
    --dir "$work_root"
actual_sha256="$(shasum -a 256 "$work_root/$archive_name" | awk '{print $1}')"
if [[ "$actual_sha256" != "$archive_sha256" ]]; then
    echo "pinned release runtime archive checksum mismatch" >&2
    exit 1
fi
ditto -x -k "$work_root/$archive_name" "$extraction_root"
"$tool_node" --input-type=module -e '
  import { validateExtractedRelease } from "./scripts/release-validation.mjs";
  await validateExtractedRelease(process.argv[1], process.argv[2]);
' "$extraction_root" "$release_name"

payload="$extraction_root/$release_name/runtime/macos-arm64"
optimized_payload="$work_root/optimized-runtime"
"$payload/bin/node" "$repo_root/scripts/release/optimize-runtime.mjs" \
    "$payload" "$optimized_payload"
payload="$optimized_payload"
for destination in \
    runtime/macos-arm64/bin/node \
    runtime/macos-arm64/LICENSE.Node \
    runtime/macos-arm64/node-manifest.json \
    runtime/macos-arm64/alignment \
    runtime/macos-arm64/alignment-manifest.json \
    runtime/macos-arm64/models
do
    if [[ -e "$repo_root/$destination" || -L "$repo_root/$destination" ]]; then
        echo "refusing to replace release runtime destination: $destination" >&2
        exit 1
    fi
done
for source in \
    "$payload/bin/node" \
    "$payload/LICENSE.Node" \
    "$payload/node-manifest.json" \
    "$payload/alignment-manifest.json"
do
    if [[ ! -f "$source" || -L "$source" ]]; then
        echo "pinned release runtime file is missing or unsafe" >&2
        exit 1
    fi
done
for source in "$payload/alignment" "$payload/models"; do
    if [[ ! -d "$source" || -L "$source" ]]; then
        echo "pinned release runtime directory is missing or unsafe" >&2
        exit 1
    fi
done
install -m 0755 "$payload/bin/node" "$repo_root/runtime/macos-arm64/bin/node"
install -m 0644 "$payload/LICENSE.Node" "$repo_root/runtime/macos-arm64/LICENSE.Node"
install -m 0644 "$payload/node-manifest.json" \
    "$repo_root/runtime/macos-arm64/node-manifest.json"
install -m 0644 "$payload/alignment-manifest.json" \
    "$repo_root/runtime/macos-arm64/alignment-manifest.json"
ditto --norsrc --noextattr "$payload/alignment" \
    "$repo_root/runtime/macos-arm64/alignment"
ditto --norsrc --noextattr "$payload/models" "$repo_root/runtime/macos-arm64/models"
echo "$repo_root/runtime/macos-arm64"

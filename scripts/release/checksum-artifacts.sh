#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_root="${PODCAST_VISUALIZER_RELEASE_ROOT:-$repo_root/.build/release-artifacts}"
version="${PODCAST_VISUALIZER_VERSION:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
    echo "PODCAST_VISUALIZER_VERSION is required" >&2
    exit 64
fi
required_artifacts=(
    "Podcast-Visualizer-$version-arm64.zip"
    "Podcast-Visualizer-$version-arm64.dmg"
    appcast.xml
    Package.resolved
    BUILD-METADATA.txt
    ARTIFACT-SIZES.json
    SBOM.cdx.json
    NOTARIZATION-APP.json
    NOTARIZATION-DMG.json
)
delta_artifacts=()
while IFS= read -r -d '' delta; do
    delta_artifacts+=("$(basename "$delta")")
done < <(find "$release_root" -maxdepth 1 -type f -name 'Podcast Visualizer*.delta' -print0)
if [[ "${#delta_artifacts[@]}" -ne 1 || -L "$release_root/${delta_artifacts[0]}" ]]; then
    echo "expected exactly one regular Sparkle delta artifact" >&2
    exit 1
fi
required_artifacts+=("${delta_artifacts[0]}")
if [[ -e "$release_root/SHA256SUMS" ]]; then
    echo "refusing to replace existing SHA256SUMS" >&2
    exit 1
fi
for artifact in "${required_artifacts[@]}"; do
    if [[ ! -f "$release_root/$artifact" ]]; then
        echo "missing release artifact: $artifact" >&2
        exit 1
    fi
done
(
    cd "$release_root"
    shasum -a 256 "${required_artifacts[@]}" > SHA256SUMS
    shasum -a 256 -c SHA256SUMS
)

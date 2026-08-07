#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifacts_root="$repo_root/.build/macos-app"
app_path="$artifacts_root/Podcast Visualizer.app"
contents="$app_path/Contents"
binary_name="PodcastVisualizer"

case "$artifacts_root" in
    "$repo_root"/.build/*) ;;
    *) echo "refusing unsafe artifact path: $artifacts_root" >&2; exit 1 ;;
esac

swift build --package-path "$repo_root/macos"
binary_root="$(swift build --package-path "$repo_root/macos" --show-bin-path)"

rm -rf "$artifacts_root"
mkdir -p "$contents/MacOS" "$contents/Resources/brand"
install -m 0755 "$binary_root/$binary_name" "$contents/MacOS/$binary_name"
install -m 0644 "$repo_root/macos/Sources/PodcastVisualizerApp/Info.plist" "$contents/Info.plist"
install -m 0644 "$repo_root/resources/brand/dust-wave-v1.json" \
    "$contents/Resources/brand/dust-wave-v1.json"
plutil -lint "$contents/Info.plist" >/dev/null

echo "$app_path"

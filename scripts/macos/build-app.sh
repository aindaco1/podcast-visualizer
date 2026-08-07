#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifacts_root="$repo_root/.build/macos-app"
app_path="$artifacts_root/Podcast Visualizer.app"
contents="$app_path/Contents"
binary_name="PodcastVisualizer"
cli_root="$contents/Resources/CLI"

case "$artifacts_root" in
    "$repo_root"/.build/*) ;;
    *) echo "refusing unsafe artifact path: $artifacts_root" >&2; exit 1 ;;
esac

swift build --package-path "$repo_root/macos"
binary_root="$(swift build --package-path "$repo_root/macos" --show-bin-path)"

rm -rf "$artifacts_root"
mkdir -p \
    "$contents/MacOS" \
    "$cli_root/node_modules/@dustwave" \
    "$cli_root/alignment-runner" \
    "$cli_root/scripts"
install -m 0755 "$binary_root/$binary_name" "$contents/MacOS/$binary_name"
install -m 0644 "$repo_root/macos/Sources/PodcastVisualizerApp/Info.plist" "$contents/Info.plist"

for relative in \
    LICENSE README.md SECURITY.md THIRD_PARTY_NOTICES.md package.json \
    bin src review-ui licenses resources runtime
do
    ditto --norsrc --noextattr "$repo_root/$relative" "$cli_root/$relative"
done
ditto --norsrc --noextattr \
    "$repo_root/shared/dust-wave-platform/packages/timed-text" \
    "$cli_root/node_modules/@dustwave/timed-text"
for relative in LICENSE README.md pyproject.toml uv.lock src
do
    ditto --norsrc --noextattr \
        "$repo_root/alignment-runner/$relative" \
        "$cli_root/alignment-runner/$relative"
done
install -m 0755 "$repo_root/scripts/fetch-alignment-model.mjs" \
    "$cli_root/scripts/fetch-alignment-model.mjs"

plutil -lint "$contents/Info.plist" >/dev/null
"$cli_root/runtime/macos-arm64/bin/node" \
    "$repo_root/scripts/macos/verify-app.mjs" "$app_path" >/dev/null

echo "$app_path"

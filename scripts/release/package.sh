#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_root="${PODCAST_VISUALIZER_RELEASE_ROOT:-$repo_root/.build/release-artifacts}"
app_path="$release_root/Podcast Visualizer.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$app_path/Contents/Info.plist" 2>/dev/null || true)"
archive_path="$release_root/Podcast-Visualizer-$version-arm64.zip"
dmg_path="$release_root/Podcast-Visualizer-$version-arm64.dmg"
staging_path="$release_root/.dmg-staging"

if [[ ! -d "$app_path" || ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
    echo "missing or invalid notarized release app" >&2
    exit 1
fi
for output in "$archive_path" "$dmg_path" "$staging_path" \
    "$release_root/Package.resolved" "$release_root/SBOM.cdx.json" \
    "$release_root/BUILD-METADATA.txt"; do
    if [[ -e "$output" ]]; then
        echo "refusing to replace existing release output: $output" >&2
        exit 1
    fi
done
xcrun stapler validate "$app_path"

mkdir -p "$staging_path"
ditto --norsrc --noextattr "$app_path" "$staging_path/Podcast Visualizer.app"
COPYFILE_DISABLE=1 ditto --norsrc --noextattr -c -k --keepParent \
    "$app_path" "$archive_path"
hdiutil create -quiet -volname "Podcast Visualizer" -srcfolder "$staging_path" \
    -format UDZO "$dmg_path"
rm -rf "$staging_path"

install -m 0644 "$repo_root/macos/Package.resolved" "$release_root/Package.resolved"
node "$repo_root/scripts/generate-sbom.mjs" "$release_root/SBOM.cdx.json" >/dev/null
"$repo_root/scripts/release/write-build-metadata.sh"

printf '%s\n%s\n' "$archive_path" "$dmg_path"

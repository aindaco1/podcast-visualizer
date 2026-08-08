#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_root="${PODCAST_VISUALIZER_RELEASE_ROOT:-$repo_root/.build/release-artifacts}"
app_path="$release_root/Podcast Visualizer.app"
metadata_path="$release_root/BUILD-METADATA.txt"
if [[ ! -d "$app_path" || -e "$metadata_path" ]]; then
    echo "release app is missing or build metadata already exists" >&2
    exit 1
fi

source_commit="$(git -C "$repo_root" rev-parse HEAD)"
source_tree="$(git -C "$repo_root" rev-parse 'HEAD^{tree}')"
source_date="$(git -C "$repo_root" show -s --format=%cI HEAD)"
app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$app_path/Contents/Info.plist")"
build_number="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
    "$app_path/Contents/Info.plist")"
minimum_macos="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' \
    "$app_path/Contents/Info.plist")"
architectures="$(lipo -archs "$app_path/Contents/MacOS/PodcastVisualizer")"
swift_output="$(swift --version)"
swift_version="${swift_output%%$'\n'*}"
xcode_version="$(xcodebuild -version | /usr/bin/tr '\n' ';')"
package_resolved_sha256="$(shasum -a 256 "$repo_root/macos/Package.resolved" | awk '{print $1}')"

temporary_path="$(mktemp "$release_root/.BUILD-METADATA.XXXXXX")"
trap 'rm -f "$temporary_path"' EXIT
{
    printf 'SOURCE_COMMIT=%s\n' "$source_commit"
    printf 'SOURCE_TREE=%s\n' "$source_tree"
    printf 'SOURCE_DATE=%s\n' "$source_date"
    printf 'APP_VERSION=%s\n' "$app_version"
    printf 'BUILD_NUMBER=%s\n' "$build_number"
    printf 'MINIMUM_MACOS=%s\n' "$minimum_macos"
    printf 'ARCHITECTURES=%s\n' "$architectures"
    printf 'SWIFT=%s\n' "$swift_version"
    printf 'XCODE=%s\n' "$xcode_version"
    printf 'PACKAGE_RESOLVED_SHA256=%s\n' "$package_resolved_sha256"
} > "$temporary_path"
chmod 0644 "$temporary_path"
mv "$temporary_path" "$metadata_path"
trap - EXIT

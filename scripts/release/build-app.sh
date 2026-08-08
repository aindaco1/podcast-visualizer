#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_root="${PODCAST_VISUALIZER_RELEASE_ROOT:-$repo_root/.build/release-artifacts}"
app_path="$release_root/Podcast Visualizer.app"
contents="$app_path/Contents"
cli_root="$contents/Resources/CLI"
version="${PODCAST_VISUALIZER_VERSION:-0.0.0-dev}"
build_number="${PODCAST_VISUALIZER_BUILD_NUMBER:-1}"
runtime_source="${PODCAST_VISUALIZER_RUNTIME_ROOT:-$repo_root/runtime}"

if [[ "$release_root" != /* || "$release_root" == "/" || "$release_root" == "$repo_root" ]]; then
    echo "refusing unsafe release root: $release_root" >&2
    exit 1
fi
if [[ -e "$app_path" ]]; then
    echo "refusing to replace existing release app: $app_path" >&2
    exit 1
fi
if [[ "$runtime_source" != /* || ! -d "$runtime_source" || -L "$runtime_source" ]]; then
    echo "release runtime source is missing or unsafe: $runtime_source" >&2
    exit 1
fi
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ \
      || ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
    echo "invalid release version or build number" >&2
    exit 64
fi

mkdir -p \
    "$contents/MacOS" \
    "$contents/Frameworks" \
    "$contents/Resources/Licenses" \
    "$cli_root/node_modules/@dustwave" \
    "$cli_root/alignment-runner" \
    "$cli_root/scripts"

swift build --package-path "$repo_root/macos" -c release --arch arm64 \
    --disable-automatic-resolution
binary_root="$(swift build --package-path "$repo_root/macos" -c release --arch arm64 \
    --show-bin-path --disable-automatic-resolution)"
binary_path="$binary_root/PodcastVisualizer"
sparkle_framework="$binary_root/Sparkle.framework"
if [[ ! -f "$binary_path" || ! -d "$sparkle_framework" ]]; then
    echo "release build is missing the app binary or Sparkle framework" >&2
    exit 1
fi

install -m 0755 "$binary_path" "$contents/MacOS/PodcastVisualizer"
install -m 0644 "$repo_root/macos/Sources/PodcastVisualizerApp/Info.plist" \
    "$contents/Info.plist"
install -m 0644 "$repo_root/macos/Resources/AppIcon.icns" \
    "$contents/Resources/AppIcon.icns"
ditto --norsrc --noextattr "$sparkle_framework" "$contents/Frameworks/Sparkle.framework"
install -m 0644 "$repo_root/macos/.build/checkouts/Sparkle/LICENSE" \
    "$contents/Resources/Licenses/Sparkle.txt"

for relative in \
    LICENSE README.md SECURITY.md THIRD_PARTY_NOTICES.md package.json \
    bin src review-ui licenses resources
do
    ditto --norsrc --noextattr "$repo_root/$relative" "$cli_root/$relative"
done
ditto --norsrc --noextattr "$runtime_source" "$cli_root/runtime"
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

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" \
    "$contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" \
    "$contents/Info.plist"
codesign --remove-signature "$contents/MacOS/PodcastVisualizer"
/usr/bin/strip -S "$contents/MacOS/PodcastVisualizer"

chmod -R u+w "$app_path"
xattr -cr "$app_path"
plutil -lint "$contents/Info.plist" >/dev/null
if [[ "$(lipo -archs "$contents/MacOS/PodcastVisualizer")" != "arm64" ]]; then
    echo "release app must be arm64-only" >&2
    exit 1
fi
if codesign --verify "$app_path" >/dev/null 2>&1; then
    echo "expected an unsigned app before release signing" >&2
    exit 1
fi
"$cli_root/runtime/macos-arm64/bin/node" \
    "$repo_root/scripts/macos/verify-app.mjs" "$app_path" >/dev/null

echo "$app_path"

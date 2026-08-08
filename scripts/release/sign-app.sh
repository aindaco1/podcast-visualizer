#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "usage: $0 <Podcast Visualizer.app> <Developer ID identity> [timestamp|none]" >&2
    exit 64
fi

app_path="$1"
signing_identity="$2"
timestamp_mode="${3:-timestamp}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
contents="$app_path/Contents"
cli_root="$contents/Resources/CLI"
framework="$contents/Frameworks/Sparkle.framework"
current="$framework/Versions/Current"

if [[ ! -d "$app_path" || ! -d "$cli_root" || ! -d "$framework" ]]; then
    echo "release app is incomplete" >&2
    exit 1
fi
case "$timestamp_mode" in
    timestamp) timestamp_flag=(--timestamp) ;;
    none) timestamp_flag=(--timestamp=none) ;;
    *) echo "invalid timestamp mode: $timestamp_mode" >&2; exit 64 ;;
esac

xattr -cr "$app_path"
common_flags=(
    --force
    --options runtime
    "${timestamp_flag[@]}"
    --sign "$signing_identity"
)

macho_paths=()
while IFS= read -r code_path; do
    [[ -n "$code_path" ]] && macho_paths+=("$code_path")
done < <("$cli_root/runtime/macos-arm64/bin/node" \
    "$repo_root/scripts/release/macho-inventory.mjs" "$cli_root")
if [[ ${#macho_paths[@]} -lt 10 ]]; then
    echo "release Mach-O inventory is unexpectedly small" >&2
    exit 1
fi

for code_path in "${macho_paths[@]}"; do
    if [[ "$(lipo -archs "$code_path")" != "arm64" ]]; then
        echo "non-arm64 CLI code in release: $code_path" >&2
        exit 1
    fi
    case "$code_path" in
        */runtime/macos-arm64/bin/node)
            codesign "${common_flags[@]}" \
                --entitlements "$repo_root/Configuration/Node.entitlements" \
                "$code_path"
            ;;
        *.dylib|*.so)
            codesign "${common_flags[@]}" "$code_path"
            ;;
        *)
            codesign "${common_flags[@]}" \
                --entitlements "$repo_root/Configuration/Helper.entitlements" \
                "$code_path"
            ;;
    esac
done

# Sparkle owns update networking through its reviewed nested services. Sign
# these bundles inside-out and preserve Downloader's upstream entitlements.
codesign "${common_flags[@]}" "$current/XPCServices/Installer.xpc"
codesign "${common_flags[@]}" --preserve-metadata=entitlements \
    "$current/XPCServices/Downloader.xpc"
codesign "${common_flags[@]}" "$current/Autoupdate"
codesign "${common_flags[@]}" "$current/Updater.app"
codesign "${common_flags[@]}" "$framework"

xattr -cr "$app_path"
codesign "${common_flags[@]}" \
    --entitlements "$repo_root/Configuration/PodcastVisualizer.entitlements" \
    "$app_path"

"$repo_root/scripts/release/check-signed-app.sh" "$app_path"

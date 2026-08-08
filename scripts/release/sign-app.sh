#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "usage: $0 <Podcast Visualizer.app> <Developer ID identity> [timestamp|none]" >&2
    exit 64
fi

app_input="$1"
signing_identity="$2"
timestamp_mode="${3:-timestamp}"
signing_keychain="${SIGNING_KEYCHAIN_PATH:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ ! -d "$app_input" || -L "$app_input" ]]; then
    echo "release app is missing or unsafe" >&2
    exit 1
fi
app_path="$(cd "$(dirname "$app_input")" && pwd -P)/$(basename "$app_input")"
contents="$app_path/Contents"
cli_root="$contents/Resources/CLI"
framework="$contents/Frameworks/Sparkle.framework"
current="$framework/Versions/Current"

if [[ ! -d "$cli_root" || ! -d "$framework" ]]; then
    echo "release app is incomplete" >&2
    exit 1
fi
case "$timestamp_mode" in
    timestamp) timestamp_flag=(--timestamp) ;;
    none) timestamp_flag=(--timestamp=none) ;;
    *) echo "invalid timestamp mode: $timestamp_mode" >&2; exit 64 ;;
esac
keychain_flags=()
if [[ -n "$signing_keychain" ]]; then
    if [[ "$signing_keychain" != /* || ! -f "$signing_keychain" || -L "$signing_keychain" ]]; then
        echo "signing keychain is missing or unsafe" >&2
        exit 1
    fi
    keychain_flags=(--keychain "$signing_keychain")
fi

xattr -cr "$app_path"
common_flags=(
    --force
    --options runtime
    "${keychain_flags[@]}"
    "${timestamp_flag[@]}"
    --sign "$signing_identity"
)

release_tool_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-release-node.XXXXXX")"
trap 'rm -rf "$release_tool_root"' EXIT
release_tool_node="$release_tool_root/node"
install -m 0755 "$cli_root/runtime/macos-arm64/bin/node" "$release_tool_node"
codesign --force --timestamp=none --sign - "$release_tool_node"
codesign --verify --strict "$release_tool_node"

macho_paths=()
while IFS= read -r code_path; do
    [[ -n "$code_path" ]] && macho_paths+=("$code_path")
done < <("$release_tool_node" \
    "$repo_root/scripts/release/macho-inventory.mjs" "$cli_root")
if [[ ${#macho_paths[@]} -lt 10 ]]; then
    echo "release Mach-O inventory is unexpectedly small" >&2
    exit 1
fi

for code_path in "${macho_paths[@]}"; do
    architectures="$(lipo -archs "$code_path")"
    if [[ ! " $architectures " == *" arm64 "* ]]; then
        echo "CLI code does not contain an arm64 slice: $code_path" >&2
        exit 1
    fi
    for architecture in $architectures; do
        case "$architecture" in
            arm64|x86_64) ;;
            *)
                echo "CLI code contains an unsupported architecture: $code_path ($architecture)" >&2
                exit 1
                ;;
        esac
    done
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

"$release_tool_node" "$repo_root/scripts/release/reseal-runtime.mjs" \
    "$cli_root/runtime/macos-arm64" >/dev/null
"$release_tool_node" --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const root = process.argv[1];
  const runtime = await import(pathToFileURL(`${root}/src/runtime.js`));
  const models = await import(pathToFileURL(`${root}/src/models.js`));
  await Promise.all([
    runtime.validateBundledRuntime(),
    runtime.validateBundledNodeRuntime(),
    runtime.validateBundledSpeechRuntime(),
    runtime.validateBundledAlignmentRuntime(),
    models.validateBundledDiarizationModel()
  ]);
' "$cli_root"

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

PODCAST_VISUALIZER_RELEASE_TOOL_NODE="$release_tool_node" \
    "$repo_root/scripts/release/check-signed-app.sh" "$app_path"

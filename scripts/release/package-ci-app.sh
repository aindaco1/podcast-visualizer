#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 6 ]]; then
    echo "usage: $0 <absolute-app> <absolute-output.tar.gz> <owner/repository> <commit> <run-id> <run-attempt>" >&2
    exit 64
fi
app_path="$1"
archive="$2"
repository="$3"
commit="$4"
run_id="$5"
run_attempt="$6"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
source "$repo_root/scripts/release/ci-build-inputs.sh"

if [[ "$app_path" != /* || ! -d "$app_path" || -L "$app_path" || \
      "$archive" != /* || ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ || \
      ! "$commit" =~ ^[a-f0-9]{40}$ || ! "$run_id" =~ ^[1-9][0-9]*$ || \
      ! "$run_attempt" =~ ^[1-9][0-9]*$ ]]; then
    echo "invalid CI app artifact input" >&2
    exit 64
fi
if [[ -e "$archive" || -L "$archive" || ! -d "$(dirname "$archive")" || \
      -L "$(dirname "$archive")" ]]; then
    echo "CI app artifact output must be an absent file in a safe directory" >&2
    exit 1
fi
if [[ "$(git -C "$repo_root" rev-parse HEAD)" != "$commit" ]] || \
    ! git -C "$repo_root" diff --quiet -- . \
        ':(exclude)runtime/macos-arm64/bin/podcast-visualizer-speech' \
        ':(exclude)runtime/macos-arm64/speech-manifest.json' || \
    ! git -C "$repo_root" diff --cached --quiet -- .; then
    echo "CI app artifact checkout changed source outside the reviewed speech output" >&2
    exit 1
fi

"$repo_root/scripts/release/validate-app-runtime.sh" "$app_path" >/dev/null
info="$app_path/Contents/Info.plist"
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info")" != \
      "0.0.0-dev" || "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info")" != "1" ]]; then
    echo "CI app must retain its neutral version and build identity" >&2
    exit 1
fi
if codesign --verify "$app_path" >/dev/null 2>&1; then
    echo "CI app must remain unsigned before release" >&2
    exit 1
fi

sparkle_root="$repo_root/macos/.build/artifacts/sparkle/Sparkle"
generate_appcast="$sparkle_root/bin/generate_appcast"
sign_update="$sparkle_root/bin/sign_update"
for tool in "$generate_appcast" "$sign_update"; do
    if [[ ! -x "$tool" || -L "$tool" ]]; then
        echo "CI app is missing a safe Sparkle release tool" >&2
        exit 1
    fi
done

work_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-ci-app-package.XXXXXX")"
cleanup() {
    /bin/rm -rf -- "$work_root"
}
trap cleanup EXIT
bundle_root="$work_root/podcast-visualizer-ci-build"
mkdir -p "$bundle_root/app" "$bundle_root/sparkle-tools"
ditto --norsrc --noextattr "$app_path" "$bundle_root/app/Podcast Visualizer.app"
install -m 0755 "$generate_appcast" "$bundle_root/sparkle-tools/generate_appcast"
install -m 0755 "$sign_update" "$bundle_root/sparkle-tools/sign_update"

input_digest="$(podcast_visualizer_ci_build_input_digest "$repo_root")"
xcode_version_output="$(xcodebuild -version)"
xcode_version="${xcode_version_output%%$'\n'*}"
packaged_app="$bundle_root/app/Podcast Visualizer.app"
app_executable="$packaged_app/Contents/MacOS/PodcastVisualizer"
sparkle_binary="$packaged_app/Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle"
record_revision="$(git -C "$repo_root/shared/record" rev-parse HEAD)"
jq -n \
    --arg repository "$repository" \
    --arg commit "$commit" \
    --argjson runID "$run_id" \
    --argjson runAttempt "$run_attempt" \
    --arg xcodeVersion "$xcode_version" \
    --arg inputDigestSHA256 "$input_digest" \
    --arg appExecutableSHA256 "$(shasum -a 256 "$app_executable" | awk '{print $1}')" \
    --arg sparkleFrameworkSHA256 "$(shasum -a 256 "$sparkle_binary" | awk '{print $1}')" \
    --arg generateAppcastSHA256 "$(shasum -a 256 "$bundle_root/sparkle-tools/generate_appcast" | awk '{print $1}')" \
    --arg signUpdateSHA256 "$(shasum -a 256 "$bundle_root/sparkle-tools/sign_update" | awk '{print $1}')" \
    --arg speechSidecarSHA256 "$(shasum -a 256 "$packaged_app/Contents/Resources/CLI/runtime/macos-arm64/bin/podcast-visualizer-speech" | awk '{print $1}')" \
    --arg speechManifestSHA256 "$(shasum -a 256 "$packaged_app/Contents/Resources/CLI/runtime/macos-arm64/speech-manifest.json" | awk '{print $1}')" \
    --arg recordRevision "$record_revision" \
    '{
      schema: "podcast-visualizer-ci-build-v1",
      repository: $repository,
      commit: $commit,
      workflow: ".github/workflows/ci.yml",
      runID: $runID,
      runAttempt: $runAttempt,
      runner: "github-hosted",
      xcodeVersion: $xcodeVersion,
      inputDigestSHA256: $inputDigestSHA256,
      appExecutableSHA256: $appExecutableSHA256,
      sparkleFrameworkSHA256: $sparkleFrameworkSHA256,
      generateAppcastSHA256: $generateAppcastSHA256,
      signUpdateSHA256: $signUpdateSHA256,
      speechSidecarSHA256: $speechSidecarSHA256,
      speechManifestSHA256: $speechManifestSHA256,
      recordRevision: $recordRevision
    }' > "$bundle_root/metadata.json"
chmod 0644 "$bundle_root/metadata.json"

COPYFILE_DISABLE=1 tar -czf "$archive" -C "$work_root" podcast-visualizer-ci-build
chmod 0644 "$archive"
echo "$archive"

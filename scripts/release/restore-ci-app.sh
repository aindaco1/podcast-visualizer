#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
    echo "usage: $0 <owner/repository> <commit> <absolute-app-destination> <absolute-tools-destination>" >&2
    exit 64
fi
repository="$1"
commit="$2"
app_destination="$3"
tools_destination="$4"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
source "$repo_root/scripts/release/ci-build-inputs.sh"

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ || \
      ! "$commit" =~ ^[a-f0-9]{40}$ || "$app_destination" != /* || \
      "$tools_destination" != /* || -e "$app_destination" || -L "$app_destination" || \
      -e "$tools_destination" || -L "$tools_destination" ]]; then
    echo "invalid verified CI app destination" >&2
    exit 64
fi
for required_command in gh jq python3 shasum; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
        echo "missing required CI app restore command: $required_command" >&2
        exit 1
    fi
done
version="${PODCAST_VISUALIZER_VERSION:-}"
build_number="${PODCAST_VISUALIZER_BUILD_NUMBER:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ || \
      ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
    echo "release version or build number is invalid" >&2
    exit 64
fi

required_run() {
    local runs
    runs="$(
        gh run list --repo "$repository" --workflow ci \
            --commit "$commit" --branch main --event push --status success \
            --limit 10 \
            --json databaseId,attempt,conclusion,event,headBranch,headSha,status
    )"
    jq -er --arg commit "$commit" '
      [ .[] | select(
        .headSha == $commit and .headBranch == "main" and .event == "push" and
        .status == "completed" and .conclusion == "success" and
        (.databaseId | type == "number") and (.attempt | type == "number")
      ) ]
      | if length == 0 then error("missing exact successful CI run")
        else sort_by(.databaseId) | last | [.databaseId, .attempt] | @tsv
        end
    ' <<< "$runs"
}

ci_run=""
ci_wait_deadline=$((SECONDS + 30 * 60))
until ci_run="$(required_run 2>/dev/null)"; do
    if (( SECONDS >= ci_wait_deadline )); then
        echo "exact successful CI run did not become available within 30 minutes" >&2
        exit 1
    fi
    sleep 15
done
ci_run_id="${ci_run%%$'\t'*}"
ci_run_attempt="${ci_run#*$'\t'}"
work_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/podcast-visualizer-ci-app-restore.XXXXXX")"
cleanup() {
    /bin/rm -rf -- "$work_root"
}
trap cleanup EXIT
artifact_name="podcast-visualizer-verified-app-$commit"
gh run download "$ci_run_id" --repo "$repository" \
    --name "$artifact_name" --dir "$work_root/download"
archive="$work_root/download/podcast-visualizer-ci-app-$commit.tar.gz"
if [[ ! -s "$archive" || -L "$archive" || "$(stat -f '%z' "$archive")" -gt 1073741824 ]]; then
    echo "exact CI app artifact is missing or unsafe" >&2
    exit 1
fi
gh attestation verify "$archive" \
    --repo "$repository" \
    --signer-workflow "github.com/$repository/.github/workflows/ci.yml" \
    --source-ref refs/heads/main \
    --source-digest "$commit" \
    --deny-self-hosted-runners >/dev/null

extract_root="$work_root/extracted"
python3 "$repo_root/scripts/release/extract-ci-app.py" "$archive" "$extract_root"
bundle_root="$extract_root/podcast-visualizer-ci-build"
metadata="$bundle_root/metadata.json"
app="$bundle_root/app/Podcast Visualizer.app"
tools="$bundle_root/sparkle-tools"
input_digest="$(podcast_visualizer_ci_build_input_digest "$repo_root")"
record_revision="$(git -C "$repo_root/shared/record" rev-parse HEAD)"
if [[ ! -f "$metadata" || -L "$metadata" ]] || ! jq -e \
    --arg repository "$repository" \
    --arg commit "$commit" \
    --argjson runID "$ci_run_id" \
    --argjson runAttempt "$ci_run_attempt" \
    --arg inputDigestSHA256 "$input_digest" \
    --arg recordRevision "$record_revision" '
      (keys | sort) == [
        "appExecutableSHA256", "commit", "generateAppcastSHA256",
        "inputDigestSHA256", "recordRevision", "repository", "runAttempt",
        "runID", "runner", "schema", "signUpdateSHA256",
        "sparkleFrameworkSHA256", "speechManifestSHA256",
        "speechSidecarSHA256", "workflow", "xcodeVersion"
      ] and
      .schema == "podcast-visualizer-ci-build-v1" and
      .repository == $repository and .commit == $commit and
      .workflow == ".github/workflows/ci.yml" and
      .runID == $runID and .runAttempt == $runAttempt and
      .runner == "github-hosted" and .xcodeVersion == "Xcode 26.3" and
      .inputDigestSHA256 == $inputDigestSHA256 and
      .recordRevision == $recordRevision and
      ([.appExecutableSHA256, .sparkleFrameworkSHA256,
        .generateAppcastSHA256, .signUpdateSHA256, .speechSidecarSHA256,
        .speechManifestSHA256]
        | all(type == "string" and test("^[a-f0-9]{64}$")))
    ' "$metadata" >/dev/null; then
    echo "CI app provenance metadata is invalid" >&2
    exit 1
fi

verify_hash() {
    local path="$1"
    local key="$2"
    local expected
    expected="$(jq -r ".$key" "$metadata")"
    if [[ ! -f "$path" || -L "$path" || \
          "$(shasum -a 256 "$path" | awk '{print $1}')" != "$expected" ]]; then
        echo "CI app product hash is invalid: $key" >&2
        exit 1
    fi
}
verify_hash "$app/Contents/MacOS/PodcastVisualizer" appExecutableSHA256
verify_hash "$app/Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle" \
    sparkleFrameworkSHA256
verify_hash "$tools/generate_appcast" generateAppcastSHA256
verify_hash "$tools/sign_update" signUpdateSHA256
verify_hash "$app/Contents/Resources/CLI/runtime/macos-arm64/bin/podcast-visualizer-speech" \
    speechSidecarSHA256
verify_hash "$app/Contents/Resources/CLI/runtime/macos-arm64/speech-manifest.json" \
    speechManifestSHA256
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
      "$app/Contents/Info.plist")" != "0.0.0-dev" || \
      "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
      "$app/Contents/Info.plist")" != "1" ]]; then
    echo "CI app neutral identity is invalid" >&2
    exit 1
fi

mkdir -p "$(dirname "$app_destination")" "$(dirname "$tools_destination")"
mv "$app" "$app_destination"
mv "$tools" "$tools_destination"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" \
    "$app_destination/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" \
    "$app_destination/Contents/Info.plist"
chmod -R u+w "$app_destination"
xattr -cr "$app_destination"
if codesign --verify "$app_destination" >/dev/null 2>&1; then
    echo "restored CI app must remain unsigned before release signing" >&2
    exit 1
fi
echo "restored exact CI app from CI run $ci_run_id"

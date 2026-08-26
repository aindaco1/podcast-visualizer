#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <vMAJOR.MINOR.PATCH> <Sparkle-private-key-file>" >&2
    exit 64
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_tag="$1"
private_key="$2"
"$repo_root/scripts/release/validate-tag-format.sh" "$release_tag"
version="${release_tag#v}"
release_root="${PODCAST_VISUALIZER_RELEASE_ROOT:-$repo_root/.build/release-artifacts}"
archive_name="Podcast-Visualizer-$version-arm64.zip"
archive_path="$release_root/$archive_name"
notes_path="$repo_root/docs/releases/$version.md"
appcast_path="$release_root/appcast.xml"
sparkle_tools_root="${PODCAST_VISUALIZER_SPARKLE_TOOLS_ROOT:-$repo_root/macos/.build/artifacts/sparkle/Sparkle/bin}"
generate_appcast="$sparkle_tools_root/generate_appcast"
sign_update="$sparkle_tools_root/sign_update"
previous_archive="${PODCAST_VISUALIZER_PREVIOUS_UPDATE_ARCHIVE:-}"

if [[ "$sparkle_tools_root" != /* || ! -d "$sparkle_tools_root" || \
      -L "$sparkle_tools_root" || ! -f "$archive_path" || ! -f "$notes_path" || \
      ! -x "$generate_appcast" \
      || ! -x "$sign_update" \
      || ! -f "$private_key" || -L "$private_key" || -e "$appcast_path" ]]; then
    echo "appcast inputs are missing or unsafe" >&2
    exit 1
fi
if [[ -n "$previous_archive" ]]; then
    if [[ "$previous_archive" != /* || ! -f "$previous_archive" || -L "$previous_archive" ]]; then
        echo "previous update archive is missing or unsafe" >&2
        exit 1
    fi
    previous_archive_name="$(basename "$previous_archive")"
    if [[ ! "$previous_archive_name" =~ ^Podcast-Visualizer-[0-9]+\.[0-9]+\.[0-9]+-arm64\.zip$ \
          || "$previous_archive_name" == "$archive_name" ]]; then
        echo "previous update archive name is invalid" >&2
        exit 1
    fi
fi

work_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-appcast.XXXXXX")"
trap 'rm -rf "$work_root"' EXIT
install -m 0644 "$archive_path" "$work_root/$archive_name"
install -m 0644 "$notes_path" "$work_root/Podcast-Visualizer-$version-arm64.md"
maximum_deltas=0
if [[ -n "$previous_archive" ]]; then
    install -m 0644 "$previous_archive" "$work_root/$previous_archive_name"
    maximum_deltas=1
fi

"$generate_appcast" \
    --ed-key-file "$private_key" \
    --download-url-prefix \
        "https://github.com/aindaco1/podcast-visualizer/releases/download/$release_tag/" \
    --embed-release-notes \
    --full-release-notes-url \
        "https://github.com/aindaco1/podcast-visualizer/blob/main/CHANGELOG.md" \
    --link "https://github.com/aindaco1/podcast-visualizer" \
    --maximum-versions 1 \
    --maximum-deltas "$maximum_deltas" \
    --delta-compression lzfse \
    -o "$work_root/appcast.xml" \
    "$work_root" >/dev/null

for required_fragment in \
    "releases/download/$release_tag/$archive_name" \
    "<sparkle:shortVersionString>$version</sparkle:shortVersionString>" \
    'sparkle:edSignature=' \
    '<!-- sparkle-signatures:'
do
    if ! grep -Fq "$required_fragment" "$work_root/appcast.xml"; then
        echo "generated appcast is missing: $required_fragment" >&2
        exit 1
    fi
done

delta_paths=()
while IFS= read -r -d '' candidate; do
    delta_paths+=("$candidate")
done < <(find "$work_root" -maxdepth 1 -type f -name '*.delta' -print0)
if [[ -n "$previous_archive" ]]; then
    if [[ "${#delta_paths[@]}" -ne 1 ]]; then
        echo "expected exactly one Sparkle delta, found ${#delta_paths[@]}" >&2
        exit 1
    fi
    delta_name="$(basename "${delta_paths[0]}")"
    generated_delta_url_name="${delta_name// /%20}"
    published_delta_name="${delta_name// /.}"
    generated_delta_url_count="$(grep -Fc "releases/download/$release_tag/$generated_delta_url_name" \
        "$work_root/appcast.xml" || true)"
    delta_from_count="$(grep -Fc 'sparkle:deltaFrom=' "$work_root/appcast.xml" || true)"
    if [[ ! "$delta_name" =~ ^Podcast\ Visualizer[0-9]+-[0-9]+\.delta$ \
          || ! "$published_delta_name" =~ ^Podcast\.Visualizer[0-9]+-[0-9]+\.delta$ \
          || ! -s "${delta_paths[0]}" || -L "${delta_paths[0]}" \
          || "$generated_delta_url_count" -ne 1 || "$delta_from_count" -ne 1 ]]; then
        echo "generated Sparkle delta contract is invalid" >&2
        exit 1
    fi
    /usr/bin/sed -i '' \
        "s#/$generated_delta_url_name\"#/$published_delta_name\"#" \
        "$work_root/appcast.xml"
    "$sign_update" --ed-key-file "$private_key" "$work_root/appcast.xml" >/dev/null
    "$sign_update" --verify --ed-key-file "$private_key" "$work_root/appcast.xml" >/dev/null
    if [[ "$(grep -Fc "releases/download/$release_tag/$published_delta_name" \
          "$work_root/appcast.xml" || true)" -ne 1 \
          || "$(grep -Fc "releases/download/$release_tag/$generated_delta_url_name" \
          "$work_root/appcast.xml" || true)" -ne 0 ]]; then
        echo "published Sparkle delta URL contract is invalid" >&2
        exit 1
    fi
    if [[ -e "$release_root/$published_delta_name" ]]; then
        echo "refusing to replace existing Sparkle delta" >&2
        exit 1
    fi
    install -m 0644 "${delta_paths[0]}" "$release_root/$published_delta_name"
fi

install -m 0644 "$work_root/appcast.xml" "$appcast_path"
echo "$appcast_path"

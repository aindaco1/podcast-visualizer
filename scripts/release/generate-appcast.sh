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
generate_appcast="$repo_root/macos/.build/artifacts/sparkle/Sparkle/bin/generate_appcast"

if [[ ! -f "$archive_path" || ! -f "$notes_path" || ! -x "$generate_appcast" \
      || ! -f "$private_key" || -L "$private_key" || -e "$appcast_path" ]]; then
    echo "appcast inputs are missing or unsafe" >&2
    exit 1
fi

work_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-appcast.XXXXXX")"
trap 'rm -rf "$work_root"' EXIT
install -m 0644 "$archive_path" "$work_root/$archive_name"
install -m 0644 "$notes_path" "$work_root/Podcast-Visualizer-$version-arm64.md"

"$generate_appcast" \
    --ed-key-file "$private_key" \
    --download-url-prefix \
        "https://github.com/aindaco1/podcast-visualizer/releases/download/$release_tag/" \
    --embed-release-notes \
    --full-release-notes-url \
        "https://github.com/aindaco1/podcast-visualizer/blob/main/CHANGELOG.md" \
    --link "https://github.com/aindaco1/podcast-visualizer" \
    --maximum-deltas 0 \
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

install -m 0644 "$work_root/appcast.xml" "$appcast_path"
echo "$appcast_path"

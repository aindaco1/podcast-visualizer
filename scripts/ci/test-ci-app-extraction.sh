#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
extractor="$repo_root/scripts/release/extract-ci-app.py"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-ci-app-extraction.XXXXXX")"
cleanup() {
    /bin/rm -rf -- "$test_root"
}
trap cleanup EXIT

fixture="$test_root/fixture/podcast-visualizer-ci-build"
mkdir -p "$fixture/app/Podcast Visualizer.app/Contents/MacOS" \
    "$fixture/app/Podcast Visualizer.app/Contents/Frameworks/Demo.framework/Versions/B" \
    "$fixture/sparkle-tools"
printf '{}\n' > "$fixture/metadata.json"
chmod 0600 "$fixture/metadata.json"
printf 'binary\n' > "$fixture/app/Podcast Visualizer.app/Contents/MacOS/PodcastVisualizer"
chmod 0755 "$fixture/app/Podcast Visualizer.app/Contents/MacOS/PodcastVisualizer"
printf 'framework\n' > \
    "$fixture/app/Podcast Visualizer.app/Contents/Frameworks/Demo.framework/Versions/B/Demo"
ln -s B "$fixture/app/Podcast Visualizer.app/Contents/Frameworks/Demo.framework/Versions/Current"
ln -s Versions/Current/Demo \
    "$fixture/app/Podcast Visualizer.app/Contents/Frameworks/Demo.framework/Demo"
printf 'tool\n' > "$fixture/sparkle-tools/generate_appcast"
chmod 0755 "$fixture/sparkle-tools/generate_appcast"
chmod 0700 "$fixture/app/Podcast Visualizer.app/Contents/MacOS"
safe_archive="$test_root/safe.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$safe_archive" -C "$test_root/fixture" \
    podcast-visualizer-ci-build
python3 "$extractor" "$safe_archive" "$test_root/extracted"
test -x "$test_root/extracted/podcast-visualizer-ci-build/app/Podcast Visualizer.app/Contents/MacOS/PodcastVisualizer"
python3 - \
    "$test_root/extracted/podcast-visualizer-ci-build/metadata.json" \
    "$test_root/extracted/podcast-visualizer-ci-build/app/Podcast Visualizer.app/Contents/MacOS" <<'PY'
import os
import stat
import sys

metadata, executable_directory = sys.argv[1:]
assert stat.S_IMODE(os.lstat(metadata).st_mode) == 0o600
assert stat.S_IMODE(os.lstat(executable_directory).st_mode) == 0o700
PY
test "$(cat "$test_root/extracted/podcast-visualizer-ci-build/app/Podcast Visualizer.app/Contents/Frameworks/Demo.framework/Demo")" = framework

python3 - "$test_root/traversal.tar.gz" "$test_root/link.tar.gz" \
    "$test_root/mode.tar.gz" <<'PY'
import io
import sys
import tarfile

traversal, link, mode = sys.argv[1:]
with tarfile.open(traversal, "w:gz") as archive:
    payload = b"escape\n"
    member = tarfile.TarInfo("podcast-visualizer-ci-build/../../escape")
    member.size = len(payload)
    archive.addfile(member, io.BytesIO(payload))
with tarfile.open(link, "w:gz") as archive:
    member = tarfile.TarInfo("podcast-visualizer-ci-build/app-link")
    member.type = tarfile.SYMTYPE
    member.linkname = "/tmp"
    archive.addfile(member)
with tarfile.open(mode, "w:gz") as archive:
    payload = b"writable\n"
    member = tarfile.TarInfo("podcast-visualizer-ci-build/world-writable")
    member.mode = 0o777
    member.size = len(payload)
    archive.addfile(member, io.BytesIO(payload))
PY
if python3 "$extractor" "$test_root/traversal.tar.gz" \
    "$test_root/traversal-output" >/dev/null 2>&1; then
    echo "CI app extractor accepted path traversal" >&2
    exit 1
fi
if python3 "$extractor" "$test_root/link.tar.gz" \
    "$test_root/link-output" >/dev/null 2>&1; then
    echo "CI app extractor accepted an escaping symbolic link" >&2
    exit 1
fi
if python3 "$extractor" "$test_root/mode.tar.gz" \
    "$test_root/mode-output" >/dev/null 2>&1; then
    echo "CI app extractor accepted an unsafe permission mode" >&2
    exit 1
fi
test ! -e "$test_root/escape"
echo "CI app extraction tests passed"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="8.1.2"
SOURCE_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
SOURCE_URL="https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz"
BUILD_ROOT="${PODCAST_VISUALIZER_FFMPEG_BUILD_ROOT:-${TMPDIR:-/tmp}/podcast-visualizer-ffmpeg-$VERSION}"
SOURCE_PARENT="$BUILD_ROOT/source"
SOURCE_DIR="$SOURCE_PARENT/ffmpeg-$VERSION"
PREFIX="$BUILD_ROOT/install"
TARBALL="$BUILD_ROOT/ffmpeg-$VERSION.tar.xz"

CONFIG_FLAGS=(
  "--prefix=$PREFIX"
  "--disable-shared"
  "--enable-static"
  "--disable-doc"
  "--disable-debug"
  "--disable-ffplay"
  "--disable-network"
  "--disable-autodetect"
  "--disable-x86asm"
  "--enable-libass"
  "--enable-videotoolbox"
  "--enable-audiotoolbox"
  "--pkg-config-flags=--static"
)

if [ "${1:-}" = "--print-config" ]; then
  printf 'version=%s\n' "$VERSION"
  printf 'sha256=%s\n' "$SOURCE_SHA256"
  printf 'url=%s\n' "$SOURCE_URL"
  printf 'license=LGPL-2.1-or-later\n'
  printf 'flags=%s\n' "${CONFIG_FLAGS[*]}"
  exit 0
fi
if [ "$#" -ne 0 ]; then
  printf 'Usage: scripts/build-ffmpeg.sh [--print-config]\n' >&2
  exit 2
fi
if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  printf 'This release sidecar build requires Apple Silicon macOS.\n' >&2
  exit 1
fi
if ! pkg-config --exists libass; then
  printf 'libass development files are required to build the sidecar.\n' >&2
  exit 1
fi
if [ -e "$SOURCE_DIR" ] || [ -e "$PREFIX" ]; then
  printf 'Refusing to replace an existing build directory: %s\n' "$BUILD_ROOT" >&2
  printf 'Choose a new PODCAST_VISUALIZER_FFMPEG_BUILD_ROOT; builds are never overwritten.\n' >&2
  exit 1
fi

hash_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

mkdir -p "$BUILD_ROOT" "$SOURCE_PARENT"
if [ ! -f "$TARBALL" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 "$SOURCE_URL" --output "$TARBALL"
fi
ACTUAL_SHA256="$(hash_file "$TARBALL")"
if [ "$ACTUAL_SHA256" != "$SOURCE_SHA256" ]; then
  printf 'FFmpeg source SHA-256 mismatch.\nexpected %s\nactual   %s\n' "$SOURCE_SHA256" "$ACTUAL_SHA256" >&2
  exit 1
fi
tar -xf "$TARBALL" -C "$SOURCE_PARENT"

(
  cd "$SOURCE_DIR"
  ./configure "${CONFIG_FLAGS[@]}"
  make -j "$(sysctl -n hw.logicalcpu)"
  make install
)

node "$REPOSITORY_ROOT/scripts/stage-ffmpeg.mjs" \
  --ffmpeg "$PREFIX/bin/ffmpeg" \
  --ffprobe "$PREFIX/bin/ffprobe" \
  --license "$SOURCE_DIR/COPYING.LGPLv2.1" \
  --source-sha256 "$SOURCE_SHA256" \
  --source-url "$SOURCE_URL" \
  --configure-flags "${CONFIG_FLAGS[*]}"

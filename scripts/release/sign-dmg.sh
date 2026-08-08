#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! -f "$1" ]]; then
    echo "usage: $0 <Podcast-Visualizer.dmg> <Developer ID identity>" >&2
    exit 64
fi
codesign --force --options runtime --timestamp --sign "$2" "$1"
codesign --verify --strict --verbose=2 "$1"

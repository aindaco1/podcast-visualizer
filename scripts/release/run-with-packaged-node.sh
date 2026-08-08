#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || "$1" != /* || ! -f "$1" || -L "$1" || ! -x "$1" ]]; then
    echo "usage: $0 <absolute-packaged-node> <script> [arguments...]" >&2
    exit 64
fi

packaged_node="$1"
shift
tool_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-packaged-node.XXXXXX")"
trap 'rm -rf "$tool_root"' EXIT
tool_node="$tool_root/node"
install -m 0755 "$packaged_node" "$tool_node"
codesign --force --timestamp=none --sign - "$tool_node"
codesign --verify --strict "$tool_node"
"$tool_node" "$@"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
runtime_root="$repo_root/runtime/macos-arm64"
tool_node="${PODCAST_VISUALIZER_RELEASE_TOOL_NODE:-$runtime_root/bin/node}"
if [[ "$tool_node" != /* || ! -x "$tool_node" || -L "$tool_node" ]]; then
    echo "complete-runtime validator requires a safe packaged Node" >&2
    exit 1
fi
"$tool_node" --input-type=module -e '
  import { validateBundledDiarizationModel } from "./src/models.js";
  import {
    validateBundledAlignmentRuntime,
    validateBundledNodeRuntime,
    validateBundledRuntime,
    validateBundledSpeechRuntime
  } from "./src/runtime.js";
  await Promise.all([
    validateBundledRuntime(),
    validateBundledNodeRuntime(),
    validateBundledSpeechRuntime(),
    validateBundledAlignmentRuntime(),
    validateBundledDiarizationModel()
  ]);
'
"$tool_node" "$repo_root/scripts/release/validate-alignment-only-runtime.mjs" \
    "$runtime_root"

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <Podcast Visualizer.app>" >&2
    exit 64
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_path="$1"
if [[ "$app_path" != /* || ! -d "$app_path" || -L "$app_path" ]]; then
    echo "CI app runtime is missing or unsafe" >&2
    exit 1
fi
cli_root="$app_path/Contents/Resources/CLI"
runtime_root="$cli_root/runtime/macos-arm64"
tool_node="$runtime_root/bin/node"
if [[ ! -x "$tool_node" || -L "$tool_node" ]]; then
    echo "CI app runtime does not contain a safe packaged Node" >&2
    exit 1
fi
"$tool_node" "$repo_root/scripts/macos/verify-app.mjs" "$app_path" >/dev/null
# JavaScript template syntax is evaluated by Node.
# shellcheck disable=SC2016
"$tool_node" --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const cliRoot = process.argv[1];
  const runtime = await import(pathToFileURL(`${cliRoot}/src/runtime.js`));
  const models = await import(pathToFileURL(`${cliRoot}/src/models.js`));
  await Promise.all([
    runtime.validateBundledRuntime(),
    runtime.validateBundledNodeRuntime(),
    runtime.validateBundledSpeechRuntime(),
    runtime.validateBundledAlignmentRuntime(),
    models.validateBundledDiarizationModel()
  ]);
' "$cli_root"
"$tool_node" "$repo_root/scripts/release/validate-alignment-only-runtime.mjs" \
    "$runtime_root" >/dev/null
echo "$app_path"

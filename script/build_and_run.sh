#!/usr/bin/env bash
set -euo pipefail

mode="${1:-run}"
app_name="PodcastVisualizer"
bundle_id="com.aindaco.podcast-visualizer"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_bundle="$repo_root/.build/macos-app/Podcast Visualizer.app"
app_binary="$app_bundle/Contents/MacOS/$app_name"

pkill -x "$app_name" >/dev/null 2>&1 || true
"$repo_root/scripts/macos/build-app.sh" >/dev/null

open_app() {
    /usr/bin/open -n "$app_bundle"
}

case "$mode" in
    run)
        open_app
        ;;
    --debug|debug)
        lldb -- "$app_binary"
        ;;
    --logs|logs)
        open_app
        /usr/bin/log stream --info --style compact --predicate "process == \"$app_name\""
        ;;
    --telemetry|telemetry)
        open_app
        /usr/bin/log stream --info --style compact --predicate "subsystem == \"$bundle_id\""
        ;;
    --verify|verify)
        open_app
        sleep 1
        pgrep -x "$app_name" >/dev/null
        ;;
    *)
        echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
        exit 2
        ;;
esac

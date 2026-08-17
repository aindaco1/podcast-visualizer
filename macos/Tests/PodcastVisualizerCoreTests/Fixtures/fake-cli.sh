#!/bin/sh
set -eu

progress_command=fixture
if [ "${1:-}" = "subcommand" ]; then
    progress_command=review
fi

progress() {
    /usr/bin/printf '%s\n' \
        "{\"schemaVersion\":\"podcast-visualizer-progress-v1\",\"sequence\":$1,\"command\":\"$progress_command\",\"event\":\"$2\",\"detail\":{}}" >&3
}

progress 1 command.started
case "${1:-}" in
    wait)
        exec /usr/bin/yes >/dev/null
        ;;
    oversized)
        exec /usr/bin/yes x
        ;;
    environment)
        progress 2 command.completed
        /usr/bin/printf '{"modelsRoot":"%s"}\n' "${PODCAST_VISUALIZER_MODELS_ROOT:-}"
        ;;
    success)
        progress 2 command.completed
        /usr/bin/printf '{"ok":true}\n'
        ;;
    subcommand)
        progress 2 command.completed
        /usr/bin/printf '{"ok":true}\n'
        ;;
    *)
        exit 64
        ;;
esac

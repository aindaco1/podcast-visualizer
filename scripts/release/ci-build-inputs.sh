#!/usr/bin/env bash

podcast_visualizer_ci_build_input_digest() {
    if [[ $# -ne 1 ]]; then
        echo "usage: podcast_visualizer_ci_build_input_digest <repository-root>" >&2
        return 64
    fi
    local repo_root="$1"
    local relative
    local -a inputs=(
        .github/workflows/ci.yml
        .github/workflows/release.yml
        macos/Package.resolved
        speech-sidecar/Package.resolved
        scripts/build-speech-sidecar.sh
        scripts/stage-speech-sidecar.mjs
        scripts/release/build-app.sh
        scripts/release/extract-ci-app.py
        scripts/release/generate-appcast.sh
        scripts/release/package-ci-app.sh
        scripts/release/prepare-ci-app.sh
        scripts/release/restore-ci-app.sh
        scripts/release/restore-pinned-runtime.sh
        scripts/release/validate-app-runtime.sh
        scripts/release/validate-complete-runtime.sh
    )
    for relative in "${inputs[@]}"; do
        if [[ ! -f "$repo_root/$relative" || -L "$repo_root/$relative" ]]; then
            echo "CI build input is missing or unsafe: $relative" >&2
            return 1
        fi
    done
    {
        for relative in "${inputs[@]}"; do
            printf '%s  %s\n' "$(shasum -a 256 "$repo_root/$relative" | awk '{print $1}')" \
                "$relative"
        done
    } | shasum -a 256 | awk '{print $1}'
}

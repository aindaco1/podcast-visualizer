#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

swift_build_system="${PODCAST_VISUALIZER_SWIFT_BUILD_SYSTEM:-native}"
case "$swift_build_system" in
    native | swiftbuild)
        swift_build_arguments=(--build-system "$swift_build_system")
        ;;
    *)
        echo "unsupported Swift build system: $swift_build_system" >&2
        exit 1
        ;;
esac

validation_mode="${PODCAST_VISUALIZER_MACOS_VALIDATION:-full}"
case "$validation_mode" in
    compile | test | full)
        ;;
    *)
        echo "unsupported macOS validation mode: $validation_mode" >&2
        exit 1
        ;;
esac

packages=(macos speech-sidecar)
products=(PodcastVisualizer podcast-visualizer-speech)
binaries=(PodcastVisualizer podcast-visualizer-speech)

for package in "${packages[@]}"; do
    resolved_file="$repo_root/$package/Package.resolved"
    if [[ ! -f "$resolved_file" || -L "$resolved_file" ]]; then
        echo "missing or unsafe resolved dependency lock: $resolved_file" >&2
        exit 1
    fi
    resolved_before="$(shasum -a 256 "$resolved_file" | awk '{print $1}')"
    swift package --package-path "$repo_root/$package" resolve
    resolved_after="$(shasum -a 256 "$resolved_file" | awk '{print $1}')"
    if [[ "$resolved_before" != "$resolved_after" ]]; then
        echo "swift package resolve changed $package/Package.resolved" >&2
        git diff -- "$resolved_file" >&2
        exit 1
    fi
done

if [[ "$validation_mode" == "test" || "$validation_mode" == "full" ]]; then
    for package in "${packages[@]}"; do
        swift test \
            --package-path "$repo_root/$package" \
            "${swift_build_arguments[@]}" \
            --disable-automatic-resolution
    done
fi

if [[ "$validation_mode" == "compile" || "$validation_mode" == "full" ]]; then
    for index in "${!packages[@]}"; do
        package="${packages[$index]}"
        product="${products[$index]}"
        binary="${binaries[$index]}"
        build_arguments=(
            --package-path "$repo_root/$package"
            "${swift_build_arguments[@]}"
            --disable-automatic-resolution
            -c release
            --arch arm64
            --product "$product"
        )
        swift build "${build_arguments[@]}" -Xswiftc -gnone
        binary_path="$(swift build "${build_arguments[@]}" --show-bin-path)/$binary"
        if [[ ! -f "$binary_path" || -L "$binary_path" ]]; then
            echo "missing or unsafe release binary: $binary_path" >&2
            exit 1
        fi
        architectures="$(lipo -archs "$binary_path")"
        if [[ "$architectures" != "arm64" ]]; then
            echo "expected an arm64-only $binary binary, found: $architectures" >&2
            exit 1
        fi
    done
fi

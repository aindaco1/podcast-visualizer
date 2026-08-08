#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <Podcast Visualizer.app>" >&2
    exit 64
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_app="$1"
if [[ ! -d "$source_app" ]]; then
    echo "missing signed app: $source_app" >&2
    exit 1
fi

verification_root="$(mktemp -d "${TMPDIR:-/tmp}/podcast-visualizer-signature.XXXXXX")"
trap 'rm -rf "$verification_root"' EXIT
app_path="$verification_root/Podcast Visualizer.app"
ditto --norsrc --noextattr "$source_app" "$app_path"
xattr -cr "$app_path"

codesign --verify --deep --strict --verbose=2 "$app_path"
details="$(codesign -d --verbose=4 "$app_path" 2>&1)"
for expected in \
    'Identifier=com.aindaco.podcast-visualizer' \
    'Authority=Developer ID Application: Volver Health LLC (PWT3Q52LZ2)' \
    'TeamIdentifier=PWT3Q52LZ2'
do
    if ! grep -Fq "$expected" <<<"$details"; then
        echo "signed app identity is missing: $expected" >&2
        exit 1
    fi
done

compare_entitlements() {
    local code_path="$1"
    local expected_plist="$2"
    local label="$3"
    local embedded="$verification_root/$label-embedded.plist"
    local embedded_json="$verification_root/$label-embedded.json"
    local expected_json="$verification_root/$label-expected.json"
    codesign --display --entitlements "$embedded" --xml "$code_path" >/dev/null
    plutil -convert json -o "$embedded_json" "$embedded"
    plutil -convert json -o "$expected_json" "$expected_plist"
    # The JavaScript template literal must not be expanded by the shell.
    # shellcheck disable=SC2016
    node --input-type=module -e '
      import fs from "node:fs";
      const [actualPath, expectedPath, label] = process.argv.slice(1);
      const canonical = (value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : Array.isArray(value) ? value.map(canonical) : value;
      const actual = canonical(JSON.parse(fs.readFileSync(actualPath, "utf8")));
      const expected = canonical(JSON.parse(fs.readFileSync(expectedPath, "utf8")));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label} signed entitlements differ from the reviewed policy`);
      }
    ' "$embedded_json" "$expected_json" "$label"
}

compare_entitlements \
    "$app_path" \
    "$repo_root/Configuration/PodcastVisualizer.entitlements" \
    app
compare_entitlements \
    "$app_path/Contents/Resources/CLI/runtime/macos-arm64/bin/node" \
    "$repo_root/Configuration/Node.entitlements" \
    node

macho_count=0
while IFS= read -r code_path; do
    [[ -z "$code_path" ]] && continue
    codesign --verify --strict "$code_path"
    code_details="$(codesign -d --verbose=4 "$code_path" 2>&1)"
    if ! grep -Fq 'TeamIdentifier=PWT3Q52LZ2' <<<"$code_details"; then
        echo "nested code has an unexpected signing team: $code_path" >&2
        exit 1
    fi
    macho_count=$((macho_count + 1))
done < <(node "$repo_root/scripts/release/macho-inventory.mjs" \
    "$app_path/Contents/Resources/CLI")
if [[ "$macho_count" -lt 10 ]]; then
    echo "signed Mach-O inventory is unexpectedly small" >&2
    exit 1
fi

printf 'Verified Developer ID app with %d signed CLI Mach-O files.\n' "$macho_count"

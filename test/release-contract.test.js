import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => fsp.readFile(path.join(ROOT, relative), "utf8");

test("pins manual signed Sparkle updates and reviewed release entitlements", async () => {
  const [
    manifest, resolved, info, appEntitlements, nodeEntitlements, updater,
    appScene, mainWindow
  ] = await Promise.all([
    read("macos/Package.swift"),
    read("macos/Package.resolved").then(JSON.parse),
    read("macos/Sources/PodcastVisualizerApp/Info.plist"),
    read("Configuration/PodcastVisualizer.entitlements"),
    read("Configuration/Node.entitlements"),
    read("macos/Sources/PodcastVisualizerApp/Services/AppUpdateController.swift"),
    read("macos/Sources/PodcastVisualizerApp/App/PodcastVisualizerApp.swift"),
    read("macos/Sources/PodcastVisualizerApp/Views/MainWindow.swift")
  ]);
  assert.match(manifest, /Sparkle", exact: "2\.9\.5"/);
  assert.equal(resolved.pins.find(({ identity }) => identity === "sparkle")?.state.version, "2.9.5");
  assert.match(info, /<key>CFBundleShortVersionString<\/key>\s*<string>1\.0\.9<\/string>/);
  assert.match(info, /<key>LSMinimumSystemVersion<\/key>\s*<string>15\.0<\/string>/);
  assert.match(info, /releases\/latest\/download\/appcast\.xml/);
  assert.match(info, /<key>SUPublicEDKey<\/key>\s*<string>8ajIsxepisKFONyemaQE1mr4W\+EUEDUkLAvGOc3dZgo=<\/string>/);
  for (const flag of ["SUEnableAutomaticChecks", "SUAllowsAutomaticUpdates"]) {
    assert.match(info, new RegExp(`<key>${flag}</key>\\s*<false/>`));
  }
  for (const flag of ["SUEnableInstallerLauncherService", "SUEnableDownloaderService", "SURequireSignedFeed", "SUVerifyUpdateBeforeExtraction"]) {
    assert.match(info, new RegExp(`<key>${flag}</key>\\s*<true/>`));
  }
  assert.match(appEntitlements, /com\.apple\.security\.app-sandbox/);
  assert.match(appEntitlements, /com\.apple\.security\.files\.user-selected\.read-write/);
  assert.match(appEntitlements, /com\.apple\.security\.files\.downloads\.read-only/);
  assert.match(appEntitlements, /com\.apple\.security\.network\.client/);
  assert.doesNotMatch(appEntitlements, /network\.server|get-task-allow/);
  assert.match(nodeEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(nodeEntitlements, /com\.apple\.security\.inherit/);
  assert.doesNotMatch(nodeEntitlements, /get-task-allow|allow-dyld-environment-variables|disable-library-validation/);
  assert.match(updater, /SPUStandardUpdaterController/);
  assert.match(updater, /canCheckForUpdates = true/);
  assert.doesNotMatch(appScene, /CommandMenu\("Podcast Visualizer"\)/);
  assert.match(mainWindow, /ToolbarItem\(placement: \.primaryAction\)/);
  assert.match(mainWindow, /Label\("Check for Updates"/);
});

test("keeps stable macOS validation required and Xcode 27 preview advisory", async () => {
  const [ci, release, validation, actionlint, readiness] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/workflows/release.yml"),
    read("scripts/ci/validate-macos.sh"),
    read(".github/actionlint.yaml"),
    read("docs/testing/macos-27-readiness.md")
  ]);

  assert.match(ci, /name: Swift tests and arm64 builds\s+runs-on: macos-15/);
  assert.match(ci, /xcode-select --switch \/Applications\/Xcode_26\.3\.app/);
  assert.match(ci, /name: Xcode 27 compatibility \(preview\)\s+runs-on: xcode-27\s+continue-on-error: true/);
  assert.match(ci, /PODCAST_VISUALIZER_SWIFT_BUILD_SYSTEM: swiftbuild\s+PODCAST_VISUALIZER_MACOS_VALIDATION: compile/);
  assert.match(ci, /PODCAST_VISUALIZER_SWIFT_BUILD_SYSTEM: native\s+PODCAST_VISUALIZER_MACOS_VALIDATION: full/);
  assert.equal(ci.match(/\.\/scripts\/ci\/validate-macos\.sh/g)?.length, 3);
  assert.match(actionlint, /\.github\/workflows\/ci\.yml:[\s\S]*label "xcode-27" is unknown/);

  assert.match(validation, /native \| swiftbuild/);
  assert.match(validation, /compile \| test \| full/);
  assert.match(validation, /packages=\(macos speech-sidecar\)/);
  assert.match(validation, /products=\(PodcastVisualizer podcast-visualizer-speech\)/);
  assert.match(validation, /swift package --package-path "\$repo_root\/\$package" resolve/);
  assert.match(validation, /--disable-automatic-resolution/);
  assert.match(validation, /swift test/);
  assert.match(validation, /swift build/);
  assert.match(validation, /lipo -archs/);
  assert.match(validation, /expected an arm64-only/);

  assert.match(release, /xcode-select --switch \/Applications\/Xcode_26\.3\.app/);
  assert.match(release, /PODCAST_VISUALIZER_MACOS_VALIDATION: test[\s\S]*\.\/scripts\/ci\/validate-macos\.sh/);
  assert.match(readiness, /continues to support macOS 15 and later/);
  assert.match(readiness, /No speculative entitlement changes are authorized/);

  const stat = await fsp.stat(path.join(ROOT, "scripts/ci/validate-macos.sh"));
  assert.notEqual(stat.mode & 0o111, 0, "validate-macos.sh must be executable");
});

test("release scripts sign inside-out, notarize, and publish only versioned artifacts", async () => {
  const [
    buildApp, sign, notarize, packageScript, appcast, checksum,
    workflow, repairWorkflow, ciWorkflow
  ] = await Promise.all([
    read("scripts/release/build-app.sh"),
    read("scripts/release/sign-app.sh"),
    read("scripts/release/notarize.sh"),
    read("scripts/release/package.sh"),
    read("scripts/release/generate-appcast.sh"),
    read("scripts/release/checksum-artifacts.sh"),
    read(".github/workflows/release.yml"),
    read(".github/workflows/repair-release-feed.yml"),
    read(".github/workflows/ci.yml")
  ]);
  assert.doesNotMatch(sign, /codesign[^\n]*--deep/);
  assert.doesNotMatch(sign, /entitlement_flags/);
  assert.doesNotMatch(sign, /!= "arm64"/);
  assert.match(sign, /arm64\|x86_64/);
  assert.match(sign, /Configuration\/Node\.entitlements/);
  assert.match(sign, /Configuration\/Helper\.entitlements/);
  assert.match(sign, /SIGNING_KEYCHAIN_PATH/);
  assert.match(sign, /scripts\/release\/reseal-runtime\.mjs/);
  assert.match(sign, /PODCAST_VISUALIZER_RELEASE_TOOL_NODE/);
  assert.match(sign, /! -d "\$app_input" \|\| -L "\$app_input"/);
  const signingOrder = [
    '"$repo_root/scripts/release/reseal-runtime.mjs"',
    '"$current/XPCServices/Installer.xpc"',
    '"$current/XPCServices/Downloader.xpc"',
    '"$current/Autoupdate"',
    '"$current/Updater.app"',
    'codesign "${common_flags[@]}" "$framework"',
    'Configuration/PodcastVisualizer.entitlements'
  ]
    .map((fragment) => sign.indexOf(fragment));
  assert.ok(signingOrder.every((index) => index >= 0));
  assert.deepEqual(signingOrder, [...signingOrder].sort((left, right) => left - right));
  assert.match(notarize, /notarytool submit/);
  assert.match(notarize, /--wait/);
  assert.match(notarize, /stapler staple/);
  assert.match(notarize, /spctl --assess/);
  assert.match(packageScript, /Podcast-Visualizer-\$version-arm64\.zip/);
  assert.match(packageScript, /Podcast-Visualizer-\$version-arm64\.dmg/);
  assert.match(packageScript, /--zlibCompressionLevel 9/);
  assert.match(packageScript, /-format ULFO/);
  assert.match(packageScript, /run-with-packaged-node\.sh/);
  assert.match(buildApp, /-Xswiftc -gnone/);
  assert.doesNotMatch(buildApp, /strip[^\n]*PodcastVisualizer/);
  assert.match(buildApp, /PODCAST_VISUALIZER_RUNTIME_ROOT/);
  assert.match(buildApp, /ditto --norsrc --noextattr "\$runtime_source" "\$cli_root\/runtime"/);
  assert.match(appcast, /--ed-key-file "\$private_key"/);
  assert.match(appcast, /sparkle:edSignature=/);
  assert.match(appcast, /--maximum-deltas "\$maximum_deltas"/);
  assert.match(appcast, /--delta-compression lzfse/);
  assert.match(appcast, /sparkle:deltaFrom=/);
  assert.match(appcast, /published_delta_name="\$\{delta_name\/\/ \/\.\}"/);
  assert.match(appcast, /sign_update.*--ed-key-file/);
  assert.match(appcast, /"\$previous_archive" != \/\*/);
  assert.match(checksum, /Podcast\.Visualizer\*\.delta/);
  assert.match(checksum, /NOTARIZATION-APP\.json/);
  assert.match(checksum, /ARTIFACT-SIZES\.json/);
  assert.match(checksum, /SBOM\.cdx\.json/);
  assert.match(workflow, /environment: release/);
  const checkoutNode24 = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
  const setupNode24 = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
  const setupUVNode24 = "astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9";
  for (const source of [workflow, repairWorkflow, ciWorkflow]) {
    assert.match(source, new RegExp(checkoutNode24));
    assert.match(source, new RegExp(setupNode24));
    assert.doesNotMatch(source, /11d5960a326750d5838078e36cf38b85af677262|49933ea5288caeca8642d1e84afbd3f7d6820020/);
  }
  for (const source of [workflow, ciWorkflow]) {
    assert.match(source, new RegExp(setupUVNode24));
    assert.match(source, /prune-cache: true/);
    assert.doesNotMatch(source, /d0cc045d04ccac9d8b7881df0226f9e82c39688e/);
  }
  assert.match(workflow, /xcode-select --switch \/Applications\/Xcode_26\.3\.app\/Contents\/Developer/);
  assert.match(workflow, /Xcode 26\.3/);
  assert.match(workflow, /astral-sh\/setup-uv@[a-f0-9]{40}/);
  assert.match(workflow, /v0\.1\.0-rc\.3/);
  assert.match(workflow, /9ca7c55c7083925a0bf387fbf2f52bc8e34ecfe749079f03c3a3e6eb8b8dadba/);
  assert.match(workflow, /validateExtractedRelease/);
  assert.match(workflow, /validateBundledDiarizationModel/);
  assert.match(workflow, /scripts\/release\/optimize-runtime\.mjs/);
  assert.match(workflow, /Build speech sidecar from reviewed source/);
  assert.match(workflow, /PODCAST_VISUALIZER_RELEASE_TOOL_NODE: \$\{\{ github\.workspace \}\}\/runtime\/macos-arm64\/bin\/node/);
  const runtimeRestore = workflow.indexOf("- name: Restore pinned release runtime");
  const speechBuild = workflow.indexOf("- name: Build speech sidecar from reviewed source");
  const runtimeValidation = workflow.indexOf("- name: Validate complete release runtime");
  assert.ok(runtimeRestore >= 0 && runtimeRestore < speechBuild && speechBuild < runtimeValidation);
  assert.match(workflow, /scripts\/release\/validate-alignment-only-runtime\.mjs/);
  assert.match(workflow, /scripts\/release\/validate-size-budget\.mjs/);
  assert.match(workflow, /PREVIOUS_RELEASE_VERSION: "1\.0\.8"/);
  assert.match(workflow, /PREVIOUS_RELEASE_ZIP_SHA256: bf9ddf18303ac59853bdb0e39fa060d25829fb2890aa104bcf3243ed9b370f29/);
  assert.match(workflow, /Restore verified previous delta base/);
  assert.match(workflow, /previous_archive="Podcast-Visualizer-\$PREVIOUS_RELEASE_VERSION-arm64\.zip"/);
  assert.match(workflow, /gh release download "v\$PREVIOUS_RELEASE_VERSION"/);
  assert.match(workflow, /"\$PREVIOUS_RELEASE_ZIP_SHA256"/);
  assert.doesNotMatch(workflow, /v1\.0\.7|Podcast-Visualizer-1\.0\.7-arm64\.zip/);
  for (const secret of [
    "CERTIFICATE_P12_BASE64", "DEVELOPER_ID_CERTIFICATE_PASSWORD",
    "APPLE_API_KEY_P8_BASE64", "APPLE_API_KEY_ID", "APPLE_API_ISSUER_ID",
    "SPARKLE_ED25519_PRIVATE_KEY"
  ]) assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(repairWorkflow, /workflow_dispatch:/);
  assert.match(repairWorkflow, /environment: release/);
  assert.match(repairWorkflow, /git verify-tag/);
  assert.match(repairWorkflow, /repair-published-feed\.mjs/);
  assert.match(repairWorkflow, /gh release upload/);
  assert.match(repairWorkflow, /--clobber/);
  assert.match(repairWorkflow, /shasum -a 256 -c SHA256SUMS/);
  assert.match(repairWorkflow, /actions\/attest-build-provenance@[a-f0-9]{40}/);

  const scripts = await fsp.readdir(path.join(ROOT, "scripts/release"));
  for (const name of scripts.filter((item) => item.endsWith(".sh"))) {
    const stat = await fsp.stat(path.join(ROOT, "scripts/release", name));
    assert.notEqual(stat.mode & 0o111, 0, `${name} must be executable`);
  }
});

test("Mach-O release inventory detects code and rejects escaping symlinks", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-release-inventory-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const code = path.join(root, "helper");
  await fsp.writeFile(code, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
  await fsp.writeFile(path.join(root, "notes.txt"), "not code");
  const script = path.join(ROOT, "scripts/release/macho-inventory.mjs");
  const result = await run(process.execPath, [script, root]);
  assert.equal(result.stdout.trim(), code);

  await fsp.symlink("/tmp", path.join(root, "escape"));
  await assert.rejects(run(process.execPath, [script, root]), /unsafe release symlink/);
});

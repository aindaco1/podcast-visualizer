import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);

test("macOS assembly replaces only the known app bundle", async () => {
  const script = await fsp.readFile(`${ROOT}/scripts/macos/build-app.sh`, "utf8");
  assert.match(script, /app_path="\$artifacts_root\/Podcast Visualizer\.app"/);
  assert.match(script, /rm -rf "\$app_path"/);
  assert.doesNotMatch(script, /rm -rf "\$artifacts_root"/);
  assert.match(script, /AppIcon\.icns/);
  assert.match(script, /Sparkle\.framework/);
  const plist = await fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Info.plist`, "utf8");
  assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>AppIcon<\/string>/);
  const iconSource = await fsp.readFile(`${ROOT}/resources/app-icon/podcast-visualizer-app-icon-v1.png`);
  assert.equal(iconSource.readUInt32BE(16), 1024);
  assert.equal(iconSource.readUInt32BE(20), 1024);
  assert.ok((await fsp.stat(`${ROOT}/macos/Resources/AppIcon.icns`)).size > 100_000);
});

test("app verification accepts contained framework symlinks through canonical macOS paths", async (t) => {
  const fixtureRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-app-"));
  t.after(() => fsp.rm(fixtureRoot, { recursive: true, force: true }));
  const app = path.join(fixtureRoot, "Podcast Visualizer.app");
  const required = [
    "Contents/Resources/AppIcon.icns",
    "Contents/Info.plist",
    "Contents/MacOS/PodcastVisualizer",
    "Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle",
    "Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate",
    "Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc/Contents/MacOS/Downloader",
    "Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/MacOS/Installer",
    "Contents/Resources/CLI/bin/dustwave-video",
    "Contents/Resources/CLI/bin/dustwave-video.mjs",
    "Contents/Resources/CLI/runtime/macos-arm64/bin/node",
    "Contents/Resources/CLI/runtime/macos-arm64/bin/ffmpeg",
    "Contents/Resources/CLI/runtime/macos-arm64/bin/ffprobe",
    "Contents/Resources/CLI/runtime/macos-arm64/bin/podcast-visualizer-speech",
    "Contents/Resources/CLI/resources/brand/dust-wave-v1.json",
    "Contents/Resources/CLI/review-ui/index.html",
    "Contents/Resources/CLI/node_modules/@dustwave/timed-text/package.json",
    "Contents/Resources/CLI/alignment-runner/pyproject.toml",
    "Contents/Resources/CLI/LICENSE",
    "Contents/Resources/CLI/THIRD_PARTY_NOTICES.md"
  ];
  for (const relative of required) {
    const target = path.join(app, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, relative.endsWith("bin/dustwave-video")
      ? "#!/bin/sh\nprintf 'Podcast Visualizer fixture\\n'\n"
      : "fixture\n");
  }
  await fsp.chmod(path.join(app, "Contents/Resources/CLI/bin/dustwave-video"), 0o755);
  const framework = path.join(app, "Contents/Frameworks/Sparkle.framework");
  await fsp.symlink("B", path.join(framework, "Versions/Current"));
  await fsp.symlink("Versions/Current/Autoupdate", path.join(framework, "Autoupdate"));

  const verifier = path.join(ROOT, "scripts/macos/verify-app.mjs");
  const result = await run(process.execPath, [verifier, app]);
  assert.deepEqual(
    { symlinks: JSON.parse(result.stdout).symlinks, launcherChecked: JSON.parse(result.stdout).launcherChecked },
    { symlinks: 2, launcherChecked: true }
  );

  const launcher = path.join(app, "Contents/Resources/CLI/bin/dustwave-video");
  await fsp.writeFile(launcher, "#!/bin/sh\nexit 73\n");
  const structureOnly = await run(process.execPath, [verifier, "--structure-only", app]);
  assert.equal(JSON.parse(structureOnly.stdout).launcherChecked, false);
  await assert.rejects(run(process.execPath, [verifier, app]), /Command failed/);

  await fsp.symlink("/tmp", path.join(app, "escape"));
  await assert.rejects(
    run(process.execPath, [verifier, "--structure-only", app]),
    /unsafe symlink/
  );
});

test("Transcript Review reconciles, mutates, and tears down rows by stable cue identity", async () => {
  const [view, store, core, appStore] = await Promise.all([
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Views/TranscriptReviewView.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Stores/TranscriptReviewStore.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerCore/ReviewContracts.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Stores/AppStore.swift`, "utf8")
  ]);
  assert.match(view, /ForEach\(review\.visibleCues\)/);
  assert.doesNotMatch(view, /ForEach\(review\.visibleCueIndices, id: \\.self\)/);
  assert.match(view, /if let cue = review\.cue\(withID: cueID\)/);
  assert.doesNotMatch(view, /review\.cues\[[^\]]+\]/);
  assert.match(view, /mergeNextCue\(cueID: cueID/);
  assert.match(view, /setText\(\$0, for: cueID\)/);
  assert.match(store, /func cueIndex\(for cueID: ReviewCue\.ID\)/);
  assert.match(store, /ReviewEditing\.mergeNext\(cueID: cueID, in: cues\)/);
  assert.match(core, /func mergeNext\(cueID: ReviewCue\.ID, in cues: \[ReviewCue\]\)/);
  const teardown = appStore.match(/private func finishTranscriptReviewApproval\(\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(teardown);
  assert.ok(teardown.indexOf("selectedTab = .project") < teardown.indexOf("transcriptReview.markApproved()"));
});

test("Transcript Review search highlights matches without stealing typing focus", async () => {
  const view = await fsp.readFile(
    `${ROOT}/macos/Sources/PodcastVisualizerApp/Views/TranscriptReviewView.swift`,
    "utf8"
  );
  const findBar = view.match(
    /private struct ReviewFindReplaceBar: View \{([\s\S]*?)\n\}\n\nprivate struct TranscriptCueRow/
  )?.[1];
  const cueRow = view.match(/private struct TranscriptCueRow: View \{([\s\S]*)/)?.[1];
  assert.ok(findBar);
  assert.ok(cueRow);
  assert.match(findBar, /\.focused\(\$focusedField, equals: \.find\)/);
  assert.match(findBar, /\.focused\(\$focusedField, equals: \.replacement\)/);
  assert.match(cueRow, /textSelection = TextSelection\(range: range\)/);
  assert.doesNotMatch(cueRow, /textIsFocused|\.focused\(/);
});

test("Transcript summary presentation comes from reviewed identity state", async () => {
  const view = await fsp.readFile(
    `${ROOT}/macos/Sources/PodcastVisualizerApp/Views/TranscriptSection.swift`,
    "utf8"
  );
  assert.match(view, /state\.transcriptSummary/);
  assert.match(view, /summary\.presentation/);
  assert.doesNotMatch(view, /analysis\.speakers\).*anonymous speakers/);
});

test("aligned projects wait for the user to trigger rendering", async () => {
  const [core, store] = await Promise.all([
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerCore/AppState.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Stores/AppStore.swift`, "utf8")
  ]);
  assert.doesNotMatch(core, /^\s+case render\s*$/m);
  assert.match(
    core,
    /case \.empty, \.sourceSelected, \.aligned, \.rendering, \.verified, \.exported: nil/
  );
  const manualAction = store.match(/func runNext\(\) \{([\s\S]*?)\n    \}/)?.[1];
  const automaticAction = store.match(
    /private func continueAutomaticWorkflow\(\) async \{([\s\S]*?)\n    \}\n\n    private func align/
  )?.[1];
  assert.ok(manualAction);
  assert.ok(automaticAction);
  assert.match(manualAction, /case \.aligned:\s+await renderSelectedOutputs\(\)/);
  assert.doesNotMatch(automaticAction, /await render\(\)/);
  assert.doesNotMatch(automaticAction, /renderSelectedOutputs\(\)/);
});

test("signed app discovers, imports, and downloads only verified external models", async () => {
  const [window, section, appStore, appPaths, sources] = await Promise.all([
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Views/MainWindow.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Views/ModelsSection.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Stores/AppStore.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Support/AppPaths.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Services/ModelSourceLibrary.swift`, "utf8")
  ]);
  assert.match(window, /ModelsSection\(store: store\)/);
  assert.match(window, /loadModelsIfNeeded\(\)/);
  assert.match(section, /Import Existing…/);
  assert.match(section, /Button\("Download"\)/);
  assert.doesNotMatch(section, /Automatic Search Locations|Add Folder…/);
  assert.match(appStore, /commands\.importModel\(model\.rawValue, source: source\)/);
  assert.match(appStore, /commands\.downloadModel\(model\.rawValue\)/);
  assert.match(appStore, /commands\.modelsStatus\(\)/);
  assert.match(appStore, /startAccessingSecurityScopedResource\(\)/);
  assert.match(appStore, /discoverMissingModels\(\)/);
  assert.match(appStore, /guard modelLibrary\.check\(for: \.parakeet\)\?\.ok == true else \{ return \}/);
  assert.match(appStore, /guard modelLibrary\.check\(for: \.alignment\)\?\.ok == true else \{ return \}/);
  assert.match(appPaths, /applicationSupportDirectory/);
  assert.doesNotMatch(appPaths, /homeDirectoryForCurrentUser/);
  assert.match(sources, /securityScopeAllowOnlyReadAccess/);
  assert.match(sources, /maximumLocations = 8/);
  assert.match(sources, /resolvingSymlinksInPath\(\) == standardized/);
});

test("project media and saved branding are presented as project-owned copies", async () => {
  const [sourceSection, brandingSection, appStore] = await Promise.all([
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Views/SourceSection.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Views/BrandingSection.swift`, "utf8"),
    fsp.readFile(`${ROOT}/macos/Sources/PodcastVisualizerApp/Stores/AppStore.swift`, "utf8")
  ]);
  assert.match(sourceSection, /copies the selected media into it/);
  assert.match(brandingSection, /copies the logo into the project/);
  assert.match(appStore, /SecurityScopedResourceLease/);
  assert.match(appStore, /if state\.stage == \.initialized \{ sourceLease = nil \}/);
  assert.match(appStore, /projectBranding\.load\(workspace\)\s+logoLease = nil/);
});

test("private transcript, chapter, and branding payloads share one staging policy", async () => {
  const appStore = await fsp.readFile(
    `${ROOT}/macos/Sources/PodcastVisualizerApp/Stores/AppStore.swift`,
    "utf8"
  );
  assert.match(appStore, /enum PrivateEditKind: CaseIterable/);
  assert.match(appStore, /private func makePrivateEdit<Payload: Encodable>/);
  assert.equal(appStore.match(/\.withoutOverwriting/g)?.length, 1);
  assert.match(appStore, /makePrivateEdit\(payload, kind: \.review\)/);
  assert.match(appStore, /makePrivateEdit\(payload, kind: \.chapters\)/);
  assert.match(appStore, /makePrivateEdit\(payload, kind: \.branding\)/);
  assert.match(appStore, /existing transcript working copy was preserved/);
  assert.match(appStore, /existing chapter draft was preserved/);
  assert.match(appStore, /existing branding and project files were preserved/);
});

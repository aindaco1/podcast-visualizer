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
  assert.equal(JSON.parse(result.stdout).symlinks, 2);

  await fsp.symlink("/tmp", path.join(app, "escape"));
  await assert.rejects(run(process.execPath, [verifier, app]), /unsafe symlink/);
});

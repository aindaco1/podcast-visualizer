import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

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

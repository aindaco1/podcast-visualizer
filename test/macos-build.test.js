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
});

import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DMG_APP_NAME,
  validateDMGLayout
} from "../scripts/release/dmg-layout.mjs";
import { mountPointsFromAttachPlist } from "../scripts/release/verify-dmg.mjs";

async function fixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-dmg-layout-test-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, DMG_APP_NAME));
  await fsp.symlink("/Applications", path.join(root, "Applications"));
  return root;
}

test("accepts the exact single-app drag-to-Applications layout", async (context) => {
  const root = await fixture(context);
  assert.deepEqual(await validateDMGLayout(root), {
    schemaVersion: "podcast-visualizer-dmg-layout-v1",
    appName: "Podcast Visualizer.app",
    applicationsLink: "/Applications"
  });
});

test("rejects missing, redirected, and non-link Applications entries", async (context) => {
  const missing = await fixture(context);
  await fsp.unlink(path.join(missing, "Applications"));
  await assert.rejects(validateDMGLayout(missing), /entries are invalid/);

  const redirected = await fixture(context);
  await fsp.unlink(path.join(redirected, "Applications"));
  await fsp.symlink("/tmp", path.join(redirected, "Applications"));
  await assert.rejects(validateDMGLayout(redirected), /link target is invalid/);

  const directory = await fixture(context);
  await fsp.unlink(path.join(directory, "Applications"));
  await fsp.mkdir(path.join(directory, "Applications"));
  await assert.rejects(validateDMGLayout(directory), /must be a symbolic link/);
});

test("rejects extra entries and a symlinked app bundle", async (context) => {
  const extra = await fixture(context);
  await fsp.writeFile(path.join(extra, "Read Me.txt"), "unexpected\n");
  await assert.rejects(validateDMGLayout(extra), /entries are invalid/);

  const linked = await fixture(context);
  await fsp.rmdir(path.join(linked, DMG_APP_NAME));
  await fsp.symlink("/tmp", path.join(linked, DMG_APP_NAME));
  await assert.rejects(validateDMGLayout(linked), /app must be a real directory/);
});

test("extracts only valid absolute mount points from hdiutil plist data", () => {
  assert.deepEqual(mountPointsFromAttachPlist({
    "system-entities": [
      { "dev-entry": "/dev/disk4" },
      { "mount-point": "/private/tmp/verify/Podcast Visualizer" }
    ]
  }), ["/private/tmp/verify/Podcast Visualizer"]);
  assert.throws(() => mountPointsFromAttachPlist({}), /no system entities/);
  assert.throws(() => mountPointsFromAttachPlist({
    "system-entities": [{ "mount-point": "relative" }]
  }), /invalid mount point/);
});

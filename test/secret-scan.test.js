import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SECRET_SCAN_IGNORED, walkSecretScanFiles, secretTypesInText
} from "../scripts/scan-secrets.mjs";

test("secret scanning streams source files and excludes generated runtime trees", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-secret-scan-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, "src"));
  await fsp.mkdir(path.join(root, ".build", "nested"), { recursive: true });
  await fsp.mkdir(path.join(root, "runtime", "nested"), { recursive: true });
  await fsp.writeFile(path.join(root, "src", "app.js"), "export {};\n");
  await fsp.writeFile(path.join(root, ".build", "nested", "generated.js"), "ignored\n");
  await fsp.writeFile(path.join(root, "runtime", "nested", "generated.py"), "ignored\n");

  const files = [];
  for await (const file of walkSecretScanFiles(root)) files.push(path.relative(root, file));
  assert.deepEqual(files, [path.join("src", "app.js")]);
  assert.equal(SECRET_SCAN_IGNORED.has(".build"), true);
  assert.equal(SECRET_SCAN_IGNORED.has("runtime"), true);
});

test("secret detection accepts both GitHub installation-token formats without returning values", () => {
  const tokens = [
    ["ghs", "a".repeat(36)].join("_"),
    ...[128, 256].map((n) => ["ghs", "12345", ["eyJ" + "a".repeat(30), "b_c-".repeat(n), "d_e-".repeat(20)].join(".")].join("_")),
    ["ghp", "a".repeat(36)].join("_")
  ];
  for (const token of tokens) {
    assert.deepEqual(secretTypesInText(`before ${token} after`), ["GitHub token"]);
    assert.deepEqual(secretTypesInText(token), ["GitHub token"]);
  }
  assert.deepEqual(secretTypesInText("ghs_test ghp_fixture"), []);
});

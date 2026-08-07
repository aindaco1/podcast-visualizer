import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { importParakeetModel, validateParakeetEvidence } from "../src/model-management.js";

function syntheticEvidence() {
  return {
    schemaVersion: "podcast-visualizer-parakeet-manifest-v1",
    model: "parakeet-tdt-0.6b-v3-coreml",
    sourceRevision: "aed02740059203c4a87495924f685de3722ae9ce",
    localFolderName: "parakeet-tdt-0.6b-v3",
    files: Array.from({ length: 17 }, (_, index) => ({
      path: `Model${index}.mlmodelc/weights/weight.bin`,
      bytes: 25 * 1024 * 1024,
      sha256: String(index).padStart(64, "0")
    }))
  };
}

test("accepts bounded evidence emitted by the shared Parakeet verifier", () => {
  const evidence = syntheticEvidence();
  assert.equal(validateParakeetEvidence(evidence), evidence);
});

test("rejects traversal, duplicate files, and unexpected Parakeet identities", () => {
  const traversal = syntheticEvidence();
  traversal.files[0].path = "../escape.bin";
  assert.throws(() => validateParakeetEvidence(traversal), /unsafe path/);

  const duplicate = syntheticEvidence();
  duplicate.files[1].path = duplicate.files[0].path;
  assert.throws(() => validateParakeetEvidence(duplicate), /invalid file evidence/);

  const identity = syntheticEvidence();
  identity.sourceRevision = "0".repeat(40);
  assert.throws(() => validateParakeetEvidence(identity), /invalid manifest/);
});

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-model-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const destination = path.join(root, "installed", "parakeet-tdt-0.6b-v3");
  await fsp.mkdir(source, { mode: 0o700 });
  await fsp.writeFile(path.join(source, "model.bin"), "verified model", { mode: 0o600 });
  const manifest = {
    files: [{ path: "model.bin", bytes: 14, sha256: "f".repeat(64) }]
  };
  const verify = async (modelRoot) => {
    const content = await fsp.readFile(path.join(modelRoot, "model.bin"), "utf8");
    if (content !== "verified model") throw new Error("invalid synthetic model");
    return { manifest, modelRoot };
  };
  return { root, source, destination, manifest, verify };
}

test("imports exact verified model files atomically and reuses a verified install", async (t) => {
  const { source, destination, verify } = await fixture(t);
  const imported = await importParakeetModel(source, { destination, verify });
  assert.equal(imported.reused, false);
  assert.equal(await fsp.readFile(path.join(destination, "model.bin"), "utf8"), "verified model");
  assert.equal((await fsp.stat(path.join(destination, "model.bin"))).mode & 0o777, 0o600);

  const reused = await importParakeetModel(source, { destination, verify });
  assert.equal(reused.reused, true);
});

test("refuses symlinked model files even after source verification", async (t) => {
  const { root, source, destination, manifest } = await fixture(t);
  const outside = path.join(root, "outside.bin");
  await fsp.writeFile(outside, "verified model");
  await fsp.unlink(path.join(source, "model.bin"));
  await fsp.symlink(outside, path.join(source, "model.bin"));
  const verify = async (modelRoot) => ({ manifest, modelRoot });
  await assert.rejects(importParakeetModel(source, { destination, verify }), /unsafe path/);
  assert.equal(await fsp.lstat(destination).catch(() => null), null);
});

test("never replaces an existing unverified destination", async (t) => {
  const { source, destination, verify } = await fixture(t);
  await fsp.mkdir(destination, { recursive: true });
  await fsp.writeFile(path.join(destination, "model.bin"), "tampered");
  await assert.rejects(importParakeetModel(source, { destination, verify }), /move it aside/);
  assert.equal(await fsp.readFile(path.join(destination, "model.bin"), "utf8"), "tampered");
});

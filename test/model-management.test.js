import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  downloadVerifiedModel, importParakeetModel, PARAKEET_MODEL_FILES, validateParakeetEvidence
} from "../src/model-management.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function syntheticEvidence() {
  return {
    schemaVersion: "podcast-visualizer-parakeet-manifest-v1",
    model: "parakeet-tdt-0.6b-v3-coreml",
    sourceRevision: "aed02740059203c4a87495924f685de3722ae9ce",
    localFolderName: "parakeet-tdt-0.6b-v3",
    files: PARAKEET_MODEL_FILES.map((file) => ({ ...file }))
  };
}

test("accepts bounded evidence emitted by the shared Parakeet verifier", () => {
  const evidence = syntheticEvidence();
  assert.equal(validateParakeetEvidence(evidence), evidence);
});

test("rejects traversal, duplicate files, and unexpected Parakeet identities", () => {
  const traversal = syntheticEvidence();
  traversal.files[0].path = "../escape.bin";
  assert.throws(() => validateParakeetEvidence(traversal), /invalid file evidence/);

  const duplicate = syntheticEvidence();
  duplicate.files[1].path = duplicate.files[0].path;
  assert.throws(() => validateParakeetEvidence(duplicate), /invalid file evidence/);

  const identity = syntheticEvidence();
  identity.sourceRevision = "0".repeat(40);
  assert.throws(() => validateParakeetEvidence(identity), /invalid manifest/);
});

test("keeps the JavaScript download allowlist synchronized with the shared Swift verifier", async () => {
  const source = await fsp.readFile(path.join(
    ROOT, "shared/record/Sources/RecordSpeech/ParakeetModelVerifier.swift"
  ), "utf8");
  const swiftFiles = [...source.matchAll(
    /\.init\(path: "([^"]+)", size: ([0-9_]+), sha256: "([a-f0-9]{64})"\)/g
  )].map((match) => ({
    path: match[1],
    bytes: Number(match[2].replaceAll("_", "")),
    sha256: match[3]
  }));
  assert.deepEqual(PARAKEET_MODEL_FILES, swiftFiles);
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

function downloadResponse(bytes, {
  url = "https://download.pytorch.org/torchaudio/models/model.bin",
  status = 200
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => name === "content-length" ? String(bytes.length) : null },
    body: Readable.from([bytes])
  };
}

async function downloadFixture(t) {
  const root = (await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-download-test-")))
    .replace(/^\/var\//, "/private/var/");
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "models", "fixture");
  const bytes = Buffer.from("verified download");
  const file = {
    path: "nested/model.bin",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: "https://download.pytorch.org/torchaudio/models/model.bin"
  };
  const verify = async (modelRoot) => {
    assert.equal(await fsp.readFile(path.join(modelRoot, file.path), "utf8"), bytes.toString());
    return { manifest: { modelVersion: file.sha256 }, modelRoot };
  };
  return { root, destination, bytes, file, verify };
}

test("streams, verifies, and atomically installs an approved model download", async (t) => {
  const { root, destination, bytes, file, verify } = await downloadFixture(t);
  const progress = [];
  const result = await downloadVerifiedModel({
    destination,
    files: [file],
    verify,
    fetcher: async () => downloadResponse(bytes),
    onProgress: async (detail) => progress.push(detail)
  });
  assert.equal(result.reused, false);
  assert.equal(await fsp.readFile(path.join(destination, file.path), "utf8"), bytes.toString());
  assert.equal((await fsp.stat(path.join(destination, file.path))).mode & 0o777, 0o600);
  assert.deepEqual(progress.at(0), { phase: "downloading-model", fraction: 0 });
  assert.deepEqual(progress.at(-1), { phase: "installing-model", fraction: 1 });
  assert.deepEqual((await fsp.readdir(path.join(root, "models"))).sort(), ["fixture"]);
});

test("rejects unapproved redirects and checksum mismatches without installing partial models", async (t) => {
  const { destination, bytes, file, verify } = await downloadFixture(t);
  await assert.rejects(downloadVerifiedModel({
    destination,
    files: [file],
    verify,
    fetcher: async () => downloadResponse(bytes, { url: "https://example.invalid/model.bin" })
  }), /unapproved host/);
  assert.equal(await fsp.lstat(destination).catch(() => null), null);

  await assert.rejects(downloadVerifiedModel({
    destination,
    files: [{ ...file, sha256: "0".repeat(64) }],
    verify,
    fetcher: async () => downloadResponse(bytes)
  }), /SHA-256 verification/);
  assert.equal(await fsp.lstat(destination).catch(() => null), null);
});

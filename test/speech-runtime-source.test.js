import assert from "node:assert/strict";
import test from "node:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../src/canonical-json.js";
import { validateSpeechRuntimeAt } from "../src/runtime.js";
import { speechRuntimeSource } from "../src/speech-runtime-source.js";

test("maps old and new speech provenance without confusing source owners", () => {
  for (const version of [1, 2, 3, 4]) {
    const field = version <= 2 ? "recordRevision" : "platformRevision";
    const source = speechRuntimeSource({ schemaVersion: `podcast-visualizer-speech-runtime-v${version}`, [field]: "a".repeat(40) });
    assert.equal(source.field, field);
    assert.equal(source.signed, version % 2 === 0);
    assert.equal(source.repository, version <= 2 ? "record" : "dust-wave-platform");
  }
});

test("rejects an unknown schema, wrong owner's revision, or malformed pin", () => {
  for (const value of [null, {},
    { schemaVersion: "podcast-visualizer-speech-runtime-v5", platformRevision: "a".repeat(40) },
    { schemaVersion: "podcast-visualizer-speech-runtime-v3", recordRevision: "a".repeat(40) },
    { schemaVersion: "podcast-visualizer-speech-runtime-v3", platformRevision: "main" }]) {
    assert.throws(() => speechRuntimeSource(value), /source is invalid/);
  }
});

test("new and legacy runtime sources retain strict fields, hashes, and signing metadata", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "speech-source-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, "bin"));
  const bytes = Buffer.from("synthetic executable evidence");
  const binary = path.join(root, "bin/podcast-visualizer-speech");
  await fsp.writeFile(binary, bytes, { mode: 0o755 });
  const write = async body => {
    const manifest = { ...body, manifestSha256: sha256(`${JSON.stringify(body)}\n`) };
    await fsp.writeFile(path.join(root, "speech-manifest.json"), JSON.stringify(manifest));
    return manifest;
  };
  for (const version of [1, 2, 3, 4]) {
    const field = version <= 2 ? "recordRevision" : "platformRevision";
    const body = { schemaVersion: `podcast-visualizer-speech-runtime-v${version}`, platform: "macos-arm64",
      minimumMacOS: "15.0", [field]: "a".repeat(40), fluidAudio: { version: "0.15.5", revision: "b".repeat(40) },
      swiftVersion: "synthetic", file: { path: "bin/podcast-visualizer-speech", bytes: bytes.length,
        sha256: sha256(bytes), dependencies: ["/usr/lib/libSystem.B.dylib"] } };
    if (version % 2 === 0) Object.assign(body, { signedFromManifestSha256: "c".repeat(64),
      signing: { schemaVersion: "podcast-visualizer-runtime-signing-v1", mode: "developer-id" } });
    await assert.rejects(validateSpeechRuntimeAt(root), /missing or invalid/);
    const manifest = await write(body);
    assert.deepEqual(await validateSpeechRuntimeAt(root), manifest);
    await write({ ...body, [field === "recordRevision" ? "platformRevision" : "recordRevision"]: "d".repeat(40) });
    await assert.rejects(validateSpeechRuntimeAt(root), /contract is invalid/);
    if (body.signing) {
      await write({ ...body, signing: { ...body.signing, mode: "ad-hoc" } });
      await assert.rejects(validateSpeechRuntimeAt(root), /contract is invalid/);
    }
    await write(body);
    await fsp.writeFile(binary, "tampered");
    await assert.rejects(validateSpeechRuntimeAt(root), /failed verification/);
    await fsp.writeFile(binary, bytes);
    await fsp.unlink(path.join(root, "speech-manifest.json"));
  }
});

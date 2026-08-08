import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { sha256 } from "../src/canonical-json.js";
import { hashFile } from "../src/files.js";
import { runtimeTreeEvidence } from "../src/runtime-tree.js";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MACOS = process.platform === "darwin";
const seal = (body) => ({ ...body, manifestSha256: sha256(`${JSON.stringify(body)}\n`) });

async function writeManifest(root, name, body) {
  await fsp.writeFile(path.join(root, name), `${JSON.stringify(seal(body), null, 2)}\n`);
  return seal(body);
}

test("reseals byte-changing Developer ID runtime evidence with manifest lineage", {
  skip: !MACOS, timeout: 30_000
}, async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-runtime-reseal-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, "bin"), { recursive: true });
  await fsp.mkdir(path.join(root, "lib"));
  await fsp.mkdir(path.join(root, "alignment", "python", "bin"), { recursive: true });
  const distInfo = path.join(root, "alignment", "site-packages", "whisperx-3.8.6.dist-info");
  await fsp.mkdir(distInfo, { recursive: true });
  await fsp.writeFile(path.join(distInfo, "METADATA"), "Name: whisperx\nVersion: 3.8.6\n");
  for (const relative of [
    "bin/node", "bin/ffmpeg", "bin/ffprobe", "bin/podcast-visualizer-speech",
    "lib/libdummy.dylib", "alignment/python/bin/python3.13"
  ]) {
    await fsp.copyFile("/usr/bin/true", path.join(root, relative));
    await fsp.chmod(path.join(root, relative), 0o755);
  }
  await fsp.writeFile(path.join(root, "LICENSE.Node"), "Node license\n");
  const evidence = async (relative, dependencies = []) => ({
    path: relative,
    bytes: (await fsp.stat(path.join(root, relative))).size,
    sha256: await hashFile(path.join(root, relative)),
    dependencies
  });
  const ffmpeg = await writeManifest(root, "manifest.json", {
    schemaVersion: "podcast-visualizer-ffmpeg-runtime-v1",
    platform: "macos-arm64",
    license: "LGPL-2.1-or-later",
    source: { sha256: "a".repeat(64) },
    configureFlags: ["--disable-network", "--enable-libass"],
    files: await Promise.all([
      evidence("bin/ffmpeg"), evidence("bin/ffprobe"), evidence("lib/libdummy.dylib")
    ])
  });
  const node = await writeManifest(root, "node-manifest.json", {
    schemaVersion: "podcast-visualizer-node-runtime-v2",
    platform: "macos-arm64",
    version: "24.19.0",
    minimumMacOS: "13.5",
    license: "Node.js contributors license",
    source: { url: "https://nodejs.org/dist/example", sha256: "b".repeat(64) },
    files: await Promise.all([evidence("bin/node"), evidence("LICENSE.Node")]),
    parentManifestSha256: "c".repeat(64),
    optimization: {
      schemaVersion: "podcast-visualizer-runtime-optimization-v1",
      removedClasses: ["mach-o-symbol-table"]
    }
  });
  const speech = await writeManifest(root, "speech-manifest.json", {
    schemaVersion: "podcast-visualizer-speech-runtime-v1",
    platform: "macos-arm64",
    minimumMacOS: "15.0",
    recordRevision: "d".repeat(40),
    fluidAudio: { version: "0.15.5", revision: "e".repeat(40) },
    swiftVersion: "6.2",
    file: await evidence("bin/podcast-visualizer-speech")
  });
  const alignment = await writeManifest(root, "alignment-manifest.json", {
    schemaVersion: "podcast-visualizer-alignment-runtime-v2",
    platform: "macos-arm64",
    minimumMacOS: "13.5",
    pythonVersion: "3.13.13",
    pythonProvider: "python-build-standalone",
    whisperxVersion: "3.8.6",
    runnerRevision: "f".repeat(40),
    sourceManifestSha256: "1".repeat(64),
    punktTab: { sha256: "2".repeat(64) },
    tree: await runtimeTreeEvidence(path.join(root, "alignment")),
    pythonLicense: { sha256: "3".repeat(64) },
    machoFilesInspected: 1,
    packages: [{ name: "whisperx", version: "3.8.6" }],
    parentManifestSha256: "4".repeat(64),
    optimization: {
      schemaVersion: "podcast-visualizer-runtime-optimization-v1",
      removedClasses: [
        "development-packages", "non-english-tokenizers", "non-runtime-python-tooling", "package-tests",
        "python-bytecode", "unused-transformer-models", "unused-whisperx-dependencies", "unused-whisperx-features"
      ]
    }
  });

  await run(process.execPath, [path.join(ROOT, "scripts/release/reseal-runtime.mjs"), root]);
  for (const [name, parent, schemaVersion] of [
    ["manifest.json", ffmpeg, "podcast-visualizer-ffmpeg-runtime-v2"],
    ["node-manifest.json", node, "podcast-visualizer-node-runtime-v3"],
    ["speech-manifest.json", speech, "podcast-visualizer-speech-runtime-v2"],
    ["alignment-manifest.json", alignment, "podcast-visualizer-alignment-runtime-v3"]
  ]) {
    const manifest = JSON.parse(await fsp.readFile(path.join(root, name), "utf8"));
    const { manifestSha256, ...body } = manifest;
    assert.equal(manifest.schemaVersion, schemaVersion);
    assert.equal(manifest.signedFromManifestSha256, parent.manifestSha256);
    assert.deepEqual(manifest.signing, {
      schemaVersion: "podcast-visualizer-runtime-signing-v1",
      mode: "developer-id"
    });
    assert.equal(manifestSha256, sha256(`${JSON.stringify(body)}\n`));
  }
  const sealedAlignment = JSON.parse(await fsp.readFile(path.join(root, "alignment-manifest.json"), "utf8"));
  assert.deepEqual(sealedAlignment.tree, await runtimeTreeEvidence(path.join(root, "alignment")));
});

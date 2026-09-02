import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../src/canonical-json.js";
import { hashFile } from "../src/files.js";
import { runtimeTreeEvidence } from "../src/runtime-tree.js";
import {
  includeOptimizedAlignmentPath, optimizeReleaseRuntime
} from "../scripts/release/runtime-optimization.mjs";

const MACOS = process.platform === "darwin";

function seal(body) {
  return { ...body, manifestSha256: sha256(`${JSON.stringify(body)}\n`) };
}

test("release runtime pruning policy preserves the alignment-only dependency path", () => {
  assert.equal(includeOptimizedAlignmentPath("site-packages/numpy/tests", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/numpy/test_utils.py", false), true);
  assert.equal(includeOptimizedAlignmentPath("site-packages/pytest", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/pytest-9.1.1.dist-info", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/pygments", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/pyannote", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/onnxruntime-1.27.0.dist-info", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/torch/include", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/torch/testing", true), true);
  assert.equal(includeOptimizedAlignmentPath("site-packages/transformers/models/bert", true), false);
  assert.equal(includeOptimizedAlignmentPath("site-packages/transformers/models/wav2vec2", true), true);
  assert.equal(includeOptimizedAlignmentPath("site-packages/whisperx/assets/pytorch_model.bin", false), false);
  assert.equal(includeOptimizedAlignmentPath("nltk_data/tokenizers/punkt_tab/spanish", true), false);
  assert.equal(includeOptimizedAlignmentPath("nltk_data/tokenizers/punkt_tab/english", true), true);
  assert.equal(includeOptimizedAlignmentPath("python/lib/libtcl9.0.dylib", false), false);
  assert.equal(includeOptimizedAlignmentPath("python/lib/module.pyc", false), false);
  assert.equal(includeOptimizedAlignmentPath("nltk_data/tokenizers/punkt_tab/english", false), true);
});

test("runtime tree evidence rejects symlinks that escape the sealed tree", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-runtime-tree-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.symlink("/tmp", path.join(root, "escape"));
  await assert.rejects(runtimeTreeEvidence(root), /unsafe symlink/);
});

test("runtime tree evidence rejects chained and dangling symlinks", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-runtime-tree-chain-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.symlink("/tmp", path.join(root, "external"));
  await fsp.symlink("external", path.join(root, "chain"));
  await fsp.symlink("missing", path.join(root, "dangling"));
  await assert.rejects(runtimeTreeEvidence(root), /unsafe symlink/);
});

test("runtime tree evidence retries only bounded transient file reads", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-runtime-tree-retry-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "runtime.bin");
  await fsp.writeFile(file, "sealed runtime");
  let attempts = 0;
  const evidence = await runtimeTreeEvidence(root, {
    hash: async (filePath) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("transient read"), { code: "ETIMEDOUT" });
      return hashFile(filePath);
    }
  });
  assert.equal(attempts, 3);
  assert.equal(evidence.files, 1);

  await assert.rejects(runtimeTreeEvidence(root, {
    hash: async () => { throw Object.assign(new Error("permanent read"), { code: "EACCES" }); }
  }), /permanent read/);
});

test("runtime tree evidence stays deterministic when bounded hashes complete out of order", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-runtime-tree-order-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  for (let index = 0; index < 32; index += 1) {
    await fsp.writeFile(path.join(root, `runtime-${String(index).padStart(2, "0")}.bin`), `sealed-${index}`);
  }
  const expected = await runtimeTreeEvidence(root);
  const observed = await runtimeTreeEvidence(root, {
    hash: async (filePath) => {
      await new Promise((resolve) => setTimeout(resolve, path.basename(filePath).length % 3));
      return hashFile(filePath);
    }
  });
  assert.deepEqual(observed, expected);
});

test("release optimization writes a new provenance-linked runtime", {
  skip: !MACOS, timeout: 30_000
}, async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-runtime-optimize-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const destination = path.join(root, "optimized");
  const alignment = path.join(source, "alignment");
  const sitePackages = path.join(alignment, "site-packages");
  await fsp.mkdir(path.join(source, "bin"), { recursive: true });
  await fsp.mkdir(path.join(source, "models"), { recursive: true });
  await fsp.mkdir(path.join(alignment, "python", "bin"), { recursive: true });
  for (const name of ["whisperx-3.8.6.dist-info", "pytest-9.1.1.dist-info"]) {
    await fsp.mkdir(path.join(sitePackages, name), { recursive: true });
    const [packageName, version] = name.replace(".dist-info", "").split(/-(?=\d)/);
    await fsp.writeFile(path.join(sitePackages, name, "METADATA"), `Name: ${packageName}\nVersion: ${version}\n`);
  }
  await fsp.mkdir(path.join(sitePackages, "pytest"));
  await fsp.mkdir(path.join(sitePackages, "library", "tests"), { recursive: true });
  await fsp.writeFile(path.join(sitePackages, "pytest", "__init__.py"), "dev only\n");
  await fsp.writeFile(path.join(sitePackages, "library", "runtime.py"), "production = True\n");
  await fsp.writeFile(path.join(sitePackages, "library", "tests", "test_runtime.py"), "test only\n");
  await fsp.writeFile(path.join(sitePackages, "library", "runtime.pyc"), "bytecode\n");
  await fsp.copyFile("/usr/bin/true", path.join(source, "bin", "node"));
  await fsp.copyFile("/usr/bin/true", path.join(alignment, "python", "bin", "python3.13"));
  await fsp.chmod(path.join(source, "bin", "node"), 0o755);
  await fsp.writeFile(path.join(source, "LICENSE.Node"), "Node license\n");
  await fsp.writeFile(path.join(source, "models", "model.bin"), "model\n");

  const nodeBody = {
    schemaVersion: "podcast-visualizer-node-runtime-v1",
    platform: "macos-arm64",
    version: "24.19.0",
    minimumMacOS: "13.5",
    license: "Node.js contributors license",
    source: { url: "https://nodejs.org/dist/example", sha256: "a".repeat(64) },
    files: [
      {
        path: "bin/node", bytes: (await fsp.stat(path.join(source, "bin", "node"))).size,
        sha256: await hashFile(path.join(source, "bin", "node")), dependencies: []
      },
      {
        path: "LICENSE.Node", bytes: (await fsp.stat(path.join(source, "LICENSE.Node"))).size,
        sha256: await hashFile(path.join(source, "LICENSE.Node")), dependencies: []
      }
    ]
  };
  const alignmentBody = {
    schemaVersion: "podcast-visualizer-alignment-runtime-v1",
    platform: "macos-arm64",
    minimumMacOS: "13.5",
    pythonVersion: "3.13.13",
    pythonProvider: "python-build-standalone",
    whisperxVersion: "3.8.6",
    runnerRevision: "b".repeat(40),
    sourceManifestSha256: "c".repeat(64),
    punktTab: { sha256: "d".repeat(64) },
    tree: await runtimeTreeEvidence(alignment),
    pythonLicense: { sha256: "e".repeat(64) },
    machoFilesInspected: 1,
    packages: [{ name: "pytest", version: "9.1.1" }, { name: "whisperx", version: "3.8.6" }]
  };
  const nodeManifest = seal(nodeBody);
  const alignmentManifest = seal(alignmentBody);
  await fsp.writeFile(path.join(source, "node-manifest.json"), `${JSON.stringify(nodeManifest)}\n`);
  await fsp.writeFile(path.join(source, "alignment-manifest.json"), `${JSON.stringify(alignmentManifest)}\n`);

  const result = await optimizeReleaseRuntime(source, destination);
  assert.deepEqual(result.removedPackages, ["pytest"]);
  assert.equal(await fsp.readFile(path.join(destination, "alignment", "site-packages", "library", "runtime.py"), "utf8"),
    "production = True\n");
  await assert.rejects(fsp.lstat(path.join(destination, "alignment", "site-packages", "library", "tests")));
  await assert.rejects(fsp.lstat(path.join(destination, "alignment", "site-packages", "pytest")));
  const optimizedNode = JSON.parse(await fsp.readFile(path.join(destination, "node-manifest.json"), "utf8"));
  const optimizedAlignment = JSON.parse(await fsp.readFile(path.join(destination, "alignment-manifest.json"), "utf8"));
  assert.equal(optimizedNode.schemaVersion, "podcast-visualizer-node-runtime-v2");
  assert.equal(optimizedNode.parentManifestSha256, nodeManifest.manifestSha256);
  assert.equal(optimizedAlignment.schemaVersion, "podcast-visualizer-alignment-runtime-v2");
  assert.equal(optimizedAlignment.parentManifestSha256, alignmentManifest.manifestSha256);
  assert.deepEqual(optimizedAlignment.packages, [{ name: "whisperx", version: "3.8.6" }]);
  assert.deepEqual(optimizedAlignment.tree,
    await runtimeTreeEvidence(path.join(destination, "alignment")));
});

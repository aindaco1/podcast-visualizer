import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { validateNodeRuntimeAt } from "../../src/runtime.js";

export async function optimizeNodeRuntime(source, destination) {
  const manifest = await validateNodeRuntimeAt(source);
  if (manifest.schemaVersion !== "podcast-visualizer-node-runtime-v1") {
    throw new Error("Node optimization requires an unmodified verified source");
  }
  await fsp.mkdir(destination, {recursive: false, mode: 0o700});
  await fsp.mkdir(path.join(destination, "bin"));
  for (const entry of manifest.files) {
    await fsp.copyFile(path.join(source, entry.path), path.join(destination, entry.path), 1);
  }
  const binary = path.join(destination, "bin/node");
  execFileSync("/usr/bin/strip", ["-S", "-x", binary]);
  execFileSync("/usr/bin/codesign", ["--force", "--timestamp=none", "--sign", "-", binary]);
  const {manifestSha256, ...original} = manifest;
  const files = await Promise.all(manifest.files.map(async entry => {
    const bytes = await fsp.readFile(path.join(destination, entry.path));
    return {...entry, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  }));
  const body = {...original, schemaVersion: "podcast-visualizer-node-runtime-v2",
    parentManifestSha256: manifestSha256,
    optimization: {schemaVersion: "podcast-visualizer-runtime-optimization-v1", removedClasses: ["mach-o-symbol-table"]},
    files};
  const result = {...body, manifestSha256: createHash("sha256").update(`${JSON.stringify(body)}\n`).digest("hex")};
  await fsp.writeFile(path.join(destination, "node-manifest.json"), `${JSON.stringify(result, null, 2)}\n`, {flag:"wx"});
  await validateNodeRuntimeAt(destination);
  return result;
}


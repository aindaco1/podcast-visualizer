#!/usr/bin/env node
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const version = process.env.PODCAST_VISUALIZER_VERSION || "";
const releaseRoot = path.resolve(process.env.PODCAST_VISUALIZER_RELEASE_ROOT || "");
const outputPath = path.join(releaseRoot, "ARTIFACT-SIZES.json");
const budgets = Object.freeze({
  appAllocatedKiB: 850_000,
  zipBytes: 355_000_000,
  dmgBytes: 510_000_000,
  deltaBytes: 250_000_000
});

if (!/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(version)
    || !path.isAbsolute(releaseRoot) || releaseRoot === path.parse(releaseRoot).root) {
  throw new Error("safe release root and semantic PODCAST_VISUALIZER_VERSION are required");
}
const rootStat = await fsp.lstat(releaseRoot).catch(() => null);
if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
  throw new Error("release root is missing or unsafe");
}
if (await fsp.lstat(outputPath).catch(() => null)) throw new Error("refusing to replace artifact size evidence");

const appPath = path.join(releaseRoot, "Podcast Visualizer.app");
const appStat = await fsp.lstat(appPath).catch(() => null);
if (!appStat || appStat.isSymbolicLink() || !appStat.isDirectory()) throw new Error("release app is missing or unsafe");
const regularFileSize = async (filePath) => {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1) {
    throw new Error(`release artifact is missing or unsafe: ${path.basename(filePath)}`);
  }
  return stat.size;
};
const zipName = `Podcast-Visualizer-${version}-arm64.zip`;
const dmgName = `Podcast-Visualizer-${version}-arm64.dmg`;
const deltaNames = (await fsp.readdir(releaseRoot)).filter((name) => /^Podcast\.Visualizer\d+-\d+\.delta$/.test(name));
if (deltaNames.length !== 1) throw new Error(`expected one Sparkle delta, found ${deltaNames.length}`);
const du = await run("/usr/bin/du", ["-sk", appPath], { maxBuffer: 1024 * 1024 });
const appAllocatedKiB = Number.parseInt(du.stdout.split(/\s+/)[0], 10);
const sizes = {
  appAllocatedKiB,
  zipBytes: await regularFileSize(path.join(releaseRoot, zipName)),
  dmgBytes: await regularFileSize(path.join(releaseRoot, dmgName)),
  deltaBytes: await regularFileSize(path.join(releaseRoot, deltaNames[0]))
};
for (const [key, limit] of Object.entries(budgets)) {
  if (!Number.isSafeInteger(sizes[key]) || sizes[key] < 1 || sizes[key] > limit) {
    throw new Error(`release size budget exceeded for ${key}: ${sizes[key]} > ${limit}`);
  }
}
if (sizes.deltaBytes >= sizes.zipBytes) throw new Error("Sparkle delta is not smaller than the full update ZIP");

const evidence = {
  schemaVersion: "podcast-visualizer-artifact-sizes-v1",
  version,
  architecture: "arm64",
  artifacts: {
    app: { name: "Podcast Visualizer.app", allocatedKiB: sizes.appAllocatedKiB },
    zip: { name: zipName, bytes: sizes.zipBytes },
    dmg: { name: dmgName, bytes: sizes.dmgBytes },
    delta: { name: deltaNames[0], bytes: sizes.deltaBytes }
  },
  budgets
};
await fsp.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o644 });
process.stdout.write(`${outputPath}\n`);

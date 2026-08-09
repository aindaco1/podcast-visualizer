import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const repairScript = path.join(ROOT, "scripts/release/repair-published-feed.mjs");
const legacyDelta = "Podcast Visualizer5-3.delta";
const normalizedDelta = "Podcast.Visualizer5-3.delta";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-feed-repair-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const download = path.join(root, "download");
  const output = path.join(root, "output");
  await fsp.mkdir(download);
  const legacyURL = `https://github.com/aindaco1/podcast-visualizer/releases/download/v1.0.1/${legacyDelta.replaceAll(" ", "%20")}`;
  const contents = new Map([
    ["appcast.xml", `<rss><item><sparkle:shortVersionString>1.0.1</sparkle:shortVersionString><enclosure url="${legacyURL}" sparkle:deltaFrom="3" /></item><!-- sparkle-signatures: TEST-SIGNATURE --></rss>\n`],
    ["BUILD-METADATA.txt", "metadata\n"],
    ["NOTARIZATION-APP.json", "{}\n"],
    ["NOTARIZATION-DMG.json", "{}\n"],
    ["Package.resolved", "{}\n"],
    ["Podcast-Visualizer-1.0.1-arm64.dmg", "dmg\n"],
    ["Podcast-Visualizer-1.0.1-arm64.zip", "full zip archive\n"],
    [normalizedDelta, "delta\n"],
    ["SBOM.cdx.json", "{}\n"]
  ]);
  const sizes = {
    schemaVersion: "podcast-visualizer-artifact-sizes-v1",
    version: "1.0.1",
    architecture: "arm64",
    artifacts: {
      app: { name: "Podcast Visualizer.app", allocatedKiB: 10 },
      zip: { name: "Podcast-Visualizer-1.0.1-arm64.zip", bytes: Buffer.byteLength(contents.get("Podcast-Visualizer-1.0.1-arm64.zip")) },
      dmg: { name: "Podcast-Visualizer-1.0.1-arm64.dmg", bytes: Buffer.byteLength(contents.get("Podcast-Visualizer-1.0.1-arm64.dmg")) },
      delta: { name: legacyDelta, bytes: Buffer.byteLength(contents.get(normalizedDelta)) }
    },
    budgets: { appAllocatedKiB: 20, zipBytes: 20, dmgBytes: 20, deltaBytes: 20 }
  };
  contents.set("ARTIFACT-SIZES.json", `${JSON.stringify(sizes, null, 2)}\n`);
  for (const [name, content] of contents) await fsp.writeFile(path.join(download, name), content);
  const checksumNames = [
    "Podcast-Visualizer-1.0.1-arm64.zip", "Podcast-Visualizer-1.0.1-arm64.dmg",
    "appcast.xml", "Package.resolved", "BUILD-METADATA.txt", "ARTIFACT-SIZES.json",
    "SBOM.cdx.json", "NOTARIZATION-APP.json", "NOTARIZATION-DMG.json", legacyDelta
  ];
  const sums = checksumNames.map((name) => {
    const actualName = name === legacyDelta ? normalizedDelta : name;
    return `${sha256(contents.get(actualName))}  ${name}`;
  }).join("\n");
  await fsp.writeFile(path.join(download, "SHA256SUMS"), `${sums}\n`);
  const key = path.join(root, "sparkle.key");
  await fsp.writeFile(key, "test-only-key\n", { mode: 0o600 });
  const signUpdate = path.join(root, "sign_update");
  await fsp.writeFile(signUpdate, `#!/usr/bin/env node
import fs from "node:fs";
const file = process.argv.at(-1);
const xml = fs.readFileSync(file, "utf8");
if (!xml.includes("<!-- sparkle-signatures:")) process.exit(2);
if (process.argv.includes("--verify")) process.exit(0);
fs.writeFileSync(file, xml.replace(/<!-- sparkle-signatures: [^>]+ -->/, "<!-- sparkle-signatures: REPAIRED-SIGNATURE -->"));
`, { mode: 0o700 });
  return { root, download, output, key, signUpdate, legacyURL };
}

test("repairs only the normalized delta metadata after verifying the legacy release", async (context) => {
  const item = await fixture(context);
  const originalAppcast = await fsp.readFile(path.join(item.download, "appcast.xml"), "utf8");
  await run(process.execPath, [repairScript, item.download, item.output, "v1.0.1", item.key, item.signUpdate]);
  assert.deepEqual((await fsp.readdir(item.output)).sort(), ["ARTIFACT-SIZES.json", "SHA256SUMS", "appcast.xml"]);
  const appcast = await fsp.readFile(path.join(item.output, "appcast.xml"), "utf8");
  assert.doesNotMatch(appcast, /Podcast%20Visualizer/);
  assert.match(appcast, /Podcast\.Visualizer5-3\.delta/);
  assert.match(appcast, /REPAIRED-SIGNATURE/);
  assert.equal(await fsp.readFile(path.join(item.download, "appcast.xml"), "utf8"), originalAppcast);
  const sizes = JSON.parse(await fsp.readFile(path.join(item.output, "ARTIFACT-SIZES.json"), "utf8"));
  assert.equal(sizes.artifacts.delta.name, normalizedDelta);
  const sums = await fsp.readFile(path.join(item.output, "SHA256SUMS"), "utf8");
  assert.match(sums, new RegExp(`  ${normalizedDelta.replaceAll(".", "\\.")}\\n`));
  assert.doesNotMatch(sums, /Podcast Visualizer/);
});

test("fails closed before output when a published asset checksum is wrong", async (context) => {
  const item = await fixture(context);
  await fsp.appendFile(path.join(item.download, normalizedDelta), "tampered\n");
  await assert.rejects(
    run(process.execPath, [repairScript, item.download, item.output, "v1.0.1", item.key, item.signUpdate]),
    /checksum mismatch/
  );
  await assert.rejects(fsp.lstat(item.output));
});

test("rejects unexpected published assets at the trust boundary", async (context) => {
  const item = await fixture(context);
  await fsp.writeFile(path.join(item.download, "unexpected.txt"), "nope\n");
  await assert.rejects(
    run(process.execPath, [repairScript, item.download, item.output, "v1.0.1", item.key, item.signUpdate]),
    /inventory is not exact/
  );
  await assert.rejects(fsp.lstat(item.output));
});

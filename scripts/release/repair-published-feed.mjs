#!/usr/bin/env node
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { hashFile } from "../../src/files.js";

const run = promisify(execFile);
const MAXIMUM_METADATA_BYTES = 1024 * 1024;
const [downloadInput, outputInput, tag = "", privateKeyInput, signUpdateInput] = process.argv.slice(2);

function fail(message) {
  throw new Error(`release feed repair refused: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} fields are invalid`);
  }
}

async function safeDirectory(input, label, { mustExist }) {
  if (!input || !path.isAbsolute(input)) fail(`${label} must be an absolute path`);
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root) fail(`${label} must be a specific directory`);
  const stat = await fsp.lstat(resolved).catch(() => null);
  if (mustExist) {
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} is missing or unsafe`);
  } else if (stat) {
    fail(`${label} must not already exist`);
  }
  return resolved;
}

async function safeFile(input, label, { executable = false } = {}) {
  if (!input || !path.isAbsolute(input)) fail(`${label} must be an absolute path`);
  const resolved = path.resolve(input);
  const stat = await fsp.lstat(resolved).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1) fail(`${label} is missing or unsafe`);
  if (executable && (stat.mode & 0o111) === 0) fail(`${label} is not executable`);
  return { path: resolved, stat };
}

async function readBounded(filePath, label) {
  const { stat } = await safeFile(filePath, label);
  if (stat.size > MAXIMUM_METADATA_BYTES) fail(`${label} is too large`);
  return fsp.readFile(filePath, "utf8");
}

function occurrenceCount(value, fragment) {
  return value.split(fragment).length - 1;
}

if (!/^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(tag)) fail("tag is not a semantic version");
const version = tag.slice(1);
const downloadRoot = await safeDirectory(downloadInput, "download root", { mustExist: true });
const outputRoot = await safeDirectory(outputInput, "output root", { mustExist: false });
const { path: privateKey } = await safeFile(privateKeyInput, "Sparkle private key");
const { path: signUpdate } = await safeFile(signUpdateInput, "Sparkle sign_update tool", { executable: true });

const zipName = `Podcast-Visualizer-${version}-arm64.zip`;
const dmgName = `Podcast-Visualizer-${version}-arm64.dmg`;
const fixedNames = [
  "appcast.xml",
  "ARTIFACT-SIZES.json",
  "BUILD-METADATA.txt",
  "NOTARIZATION-APP.json",
  "NOTARIZATION-DMG.json",
  "Package.resolved",
  dmgName,
  zipName,
  "SBOM.cdx.json",
  "SHA256SUMS"
];
const entries = await fsp.readdir(downloadRoot, { withFileTypes: true });
if (entries.some((entry) => !entry.isFile())) fail("download root contains a non-file entry");
const deltaNames = entries.map(({ name }) => name).filter((name) => /^Podcast\.Visualizer\d+-\d+\.delta$/.test(name));
if (deltaNames.length !== 1) fail(`expected one normalized Sparkle delta, found ${deltaNames.length}`);
const deltaName = deltaNames[0];
const expectedAssets = [...fixedNames, deltaName].sort();
const actualAssets = entries.map(({ name }) => name).sort();
if (actualAssets.length !== expectedAssets.length
    || actualAssets.some((name, index) => name !== expectedAssets[index])) {
  fail("published asset inventory is not exact");
}
for (const name of actualAssets) await safeFile(path.join(downloadRoot, name), `asset ${name}`);

const legacyDeltaName = deltaName.replace(/^Podcast\.Visualizer/, "Podcast Visualizer");
if (!/^Podcast Visualizer\d+-\d+\.delta$/.test(legacyDeltaName)) fail("legacy delta name is invalid");
const checksumText = await readBounded(path.join(downloadRoot, "SHA256SUMS"), "SHA256SUMS");
const checksumLines = checksumText.trimEnd().split("\n");
const checksumEntries = checksumLines.map((line) => {
  const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9 ._-]*)$/.exec(line);
  if (!match) fail("SHA256SUMS contains an invalid entry");
  return { sha256: match[1], name: match[2] };
});
const expectedChecksumNames = fixedNames.filter((name) => name !== "SHA256SUMS");
expectedChecksumNames.push(legacyDeltaName);
if (checksumEntries.length !== expectedChecksumNames.length
    || new Set(checksumEntries.map(({ name }) => name)).size !== checksumEntries.length
    || expectedChecksumNames.some((name) => !checksumEntries.some((entry) => entry.name === name))) {
  fail("SHA256SUMS inventory is not the expected legacy release inventory");
}
for (const entry of checksumEntries) {
  const actualName = entry.name === legacyDeltaName ? deltaName : entry.name;
  if (await hashFile(path.join(downloadRoot, actualName)) !== entry.sha256) {
    fail(`checksum mismatch for ${entry.name}`);
  }
}

const sizePath = path.join(downloadRoot, "ARTIFACT-SIZES.json");
let sizes;
try {
  sizes = JSON.parse(await readBounded(sizePath, "ARTIFACT-SIZES.json"));
} catch (error) {
  fail(`ARTIFACT-SIZES.json is invalid: ${error.message}`);
}
exactKeys(sizes, ["schemaVersion", "version", "architecture", "artifacts", "budgets"], "size evidence");
exactKeys(sizes.artifacts, ["app", "zip", "dmg", "delta"], "size evidence artifacts");
exactKeys(sizes.artifacts.app, ["name", "allocatedKiB"], "app size evidence");
for (const kind of ["zip", "dmg", "delta"]) exactKeys(sizes.artifacts[kind], ["name", "bytes"], `${kind} size evidence`);
exactKeys(sizes.budgets, ["appAllocatedKiB", "zipBytes", "dmgBytes", "deltaBytes"], "size budgets");
if (sizes.schemaVersion !== "podcast-visualizer-artifact-sizes-v1" || sizes.version !== version
    || sizes.architecture !== "arm64" || sizes.artifacts.app.name !== "Podcast Visualizer.app"
    || sizes.artifacts.zip.name !== zipName || sizes.artifacts.dmg.name !== dmgName
    || sizes.artifacts.delta.name !== legacyDeltaName) {
  fail("size evidence does not describe the affected release");
}
for (const [kind, name] of [["zip", zipName], ["dmg", dmgName], ["delta", deltaName]]) {
  const stat = await fsp.lstat(path.join(downloadRoot, name));
  if (!Number.isSafeInteger(sizes.artifacts[kind].bytes) || sizes.artifacts[kind].bytes !== stat.size) {
    fail(`${kind} size evidence does not match the published asset`);
  }
}
for (const [key, value] of Object.entries(sizes.budgets)) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`size budget ${key} is invalid`);
}
if (!Number.isSafeInteger(sizes.artifacts.app.allocatedKiB) || sizes.artifacts.app.allocatedKiB < 1) {
  fail("app size evidence is invalid");
}
if (sizes.artifacts.app.allocatedKiB > sizes.budgets.appAllocatedKiB
    || sizes.artifacts.zip.bytes > sizes.budgets.zipBytes
    || sizes.artifacts.dmg.bytes > sizes.budgets.dmgBytes
    || sizes.artifacts.delta.bytes > sizes.budgets.deltaBytes
    || sizes.artifacts.delta.bytes >= sizes.artifacts.zip.bytes) {
  fail("published artifact sizes violate their recorded budgets");
}

const appcastPath = path.join(downloadRoot, "appcast.xml");
const appcast = await readBounded(appcastPath, "appcast.xml");
const legacyURLName = legacyDeltaName.replaceAll(" ", "%20");
const legacyURL = `https://github.com/aindaco1/podcast-visualizer/releases/download/${tag}/${legacyURLName}`;
const repairedURL = `https://github.com/aindaco1/podcast-visualizer/releases/download/${tag}/${deltaName}`;
if (occurrenceCount(appcast, legacyURL) !== 1 || occurrenceCount(appcast, repairedURL) !== 0
    || occurrenceCount(appcast, `<sparkle:shortVersionString>${version}</sparkle:shortVersionString>`) !== 1
    || occurrenceCount(appcast, "sparkle:deltaFrom=") !== 1
    || occurrenceCount(appcast, "<!-- sparkle-signatures:") !== 1) {
  fail("appcast is not the exact affected signed feed");
}
await run(signUpdate, ["--verify", "--ed-key-file", privateKey, appcastPath], { maxBuffer: MAXIMUM_METADATA_BYTES });

await fsp.mkdir(outputRoot, { mode: 0o700 });
const repairedAppcastPath = path.join(outputRoot, "appcast.xml");
await fsp.writeFile(repairedAppcastPath, appcast.replace(legacyURL, repairedURL), { flag: "wx", mode: 0o600 });
await run(signUpdate, ["--ed-key-file", privateKey, repairedAppcastPath], { maxBuffer: MAXIMUM_METADATA_BYTES });
await run(signUpdate, ["--verify", "--ed-key-file", privateKey, repairedAppcastPath], { maxBuffer: MAXIMUM_METADATA_BYTES });
const signedAppcast = await readBounded(repairedAppcastPath, "repaired appcast.xml");
if (occurrenceCount(signedAppcast, legacyURL) !== 0 || occurrenceCount(signedAppcast, repairedURL) !== 1) {
  fail("re-signed appcast URL contract is invalid");
}
await fsp.chmod(repairedAppcastPath, 0o644);

sizes.artifacts.delta.name = deltaName;
const repairedSizePath = path.join(outputRoot, "ARTIFACT-SIZES.json");
await fsp.writeFile(repairedSizePath, `${JSON.stringify(sizes, null, 2)}\n`, { flag: "wx", mode: 0o644 });

const repairedChecksumEntries = [];
for (const entry of checksumEntries) {
  const name = entry.name === legacyDeltaName ? deltaName : entry.name;
  const source = name === "appcast.xml" || name === "ARTIFACT-SIZES.json"
    ? path.join(outputRoot, name)
    : path.join(downloadRoot, name);
  repairedChecksumEntries.push(`${await hashFile(source)}  ${name}`);
}
const repairedChecksumPath = path.join(outputRoot, "SHA256SUMS");
await fsp.writeFile(repairedChecksumPath, `${repairedChecksumEntries.join("\n")}\n`, { flag: "wx", mode: 0o644 });

process.stdout.write(`${JSON.stringify({ tag, delta: deltaName, repaired: ["appcast.xml", "ARTIFACT-SIZES.json", "SHA256SUMS"] })}\n`);

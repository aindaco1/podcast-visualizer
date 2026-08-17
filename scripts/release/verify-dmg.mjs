#!/usr/bin/env node
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { DMG_APP_NAME, validateDMGLayout } from "./dmg-layout.mjs";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MAX_BUFFER = 16 * 1024 * 1024;

async function runTool(executable, arguments_, options = {}) {
  return run(executable, arguments_, {
    maxBuffer: MAX_BUFFER,
    timeout: 180_000,
    killSignal: "SIGKILL",
    ...options
  });
}

export function mountPointsFromAttachPlist(value) {
  const entities = value?.["system-entities"];
  if (!Array.isArray(entities)) throw new Error("DMG attach response has no system entities");
  const mountPoints = [];
  for (const entity of entities) {
    if (!entity || !Object.hasOwn(entity, "mount-point")) continue;
    const mountPoint = entity["mount-point"];
    if (typeof mountPoint !== "string" || !path.isAbsolute(mountPoint)) {
      throw new Error("DMG attach response contains an invalid mount point");
    }
    mountPoints.push(mountPoint);
  }
  return mountPoints;
}

async function discoverMountedVolumes(mountRoot) {
  const entries = await fsp.readdir(mountRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(mountRoot, entry.name));
}

async function detach(mountPoint) {
  try {
    await runTool("/usr/bin/hdiutil", ["detach", mountPoint]);
  } catch (error) {
    try {
      await runTool("/usr/bin/hdiutil", ["detach", "-force", mountPoint]);
    } catch {
      throw error;
    }
  }
}

export async function verifyDMG(dmgInput) {
  if (!dmgInput || !path.isAbsolute(dmgInput)) {
    throw new Error("DMG path must be absolute");
  }
  const dmgPath = path.resolve(dmgInput);
  const dmgStat = await fsp.lstat(dmgPath).catch(() => null);
  if (!dmgStat || dmgStat.isSymbolicLink() || !dmgStat.isFile() || dmgStat.size < 1
      || !/^Podcast-Visualizer-[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?-arm64\.dmg$/.test(path.basename(dmgPath))) {
    throw new Error("DMG artifact is missing or unsafe");
  }

  const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-dmg-verify-"));
  const mountRoot = path.join(workRoot, "mounts");
  const attachPlist = path.join(workRoot, "attach.plist");
  await fsp.mkdir(mountRoot);
  let attachSucceeded = false;
  let mountPoints = [];
  let primaryError;
  let verification;

  try {
    await runTool("/usr/bin/hdiutil", ["verify", dmgPath]);
    await runTool("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", dmgPath]);
    await runTool("/usr/bin/xcrun", ["stapler", "validate", dmgPath]);

    const attached = await runTool("/usr/bin/hdiutil", [
      "attach", "-readonly", "-nobrowse", "-noautoopen",
      "-mountroot", mountRoot, "-plist", dmgPath
    ]);
    attachSucceeded = true;
    await fsp.writeFile(attachPlist, attached.stdout, { flag: "wx", mode: 0o600 });
    const converted = await runTool("/usr/bin/plutil", ["-convert", "json", "-o", "-", attachPlist]);
    mountPoints = mountPointsFromAttachPlist(JSON.parse(converted.stdout));
    if (mountPoints.length !== 1) {
      throw new Error(`DMG must mount exactly one volume; found ${mountPoints.length}`);
    }
    const mountPoint = mountPoints[0];
    const canonicalMountRoot = await fsp.realpath(mountRoot);
    const canonicalMountPoint = await fsp.realpath(mountPoint);
    const containment = path.relative(canonicalMountRoot, canonicalMountPoint);
    if (!containment || containment === ".." || containment.startsWith(`..${path.sep}`)
        || path.isAbsolute(containment)) {
      throw new Error("DMG mounted outside its private verification root");
    }

    const layout = await validateDMGLayout(canonicalMountPoint);
    const appPath = path.join(canonicalMountPoint, DMG_APP_NAME);
    await runTool(process.execPath, [path.join(ROOT, "scripts", "macos", "verify-app.mjs"), appPath]);
    await runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
    await runTool("/usr/bin/xcrun", ["stapler", "validate", appPath]);
    await runTool("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);

    verification = {
      schemaVersion: "podcast-visualizer-dmg-verification-v1",
      bytes: dmgStat.size,
      layout
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (attachSucceeded && mountPoints.length === 0) {
      mountPoints = await discoverMountedVolumes(mountRoot);
    }
    for (const mountPoint of [...new Set(mountPoints)].reverse()) {
      try {
        await detach(mountPoint);
      } catch (error) {
        primaryError ??= new Error(`failed to detach verified DMG: ${error.message}`);
      }
    }
    try {
      await fsp.rm(workRoot, { recursive: true, force: true });
    } catch (error) {
      primaryError ??= new Error(`failed to remove private DMG verification data: ${error.message}`);
    }
  }

  if (primaryError) throw primaryError;
  return verification;
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [dmgInput] = process.argv.slice(2);
  if (!dmgInput) throw new Error("usage: verify-dmg.mjs <absolute-Podcast-Visualizer.dmg>");
  process.stdout.write(`${JSON.stringify(await verifyDMG(dmgInput))}\n`);
}

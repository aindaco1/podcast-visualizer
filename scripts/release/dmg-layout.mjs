#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DMG_APP_NAME = "Podcast Visualizer.app";
export const DMG_APPLICATIONS_LINK_NAME = "Applications";
export const DMG_APPLICATIONS_LINK_TARGET = "/Applications";

const EXPECTED_ENTRIES = Object.freeze([
  DMG_APP_NAME,
  DMG_APPLICATIONS_LINK_NAME
].sort());

export async function validateDMGLayout(layoutInput) {
  if (!layoutInput || !path.isAbsolute(layoutInput)) {
    throw new Error("DMG layout root must be an absolute path");
  }
  const layoutRoot = path.resolve(layoutInput);
  if (layoutRoot === path.parse(layoutRoot).root) {
    throw new Error("DMG layout root must be a specific directory");
  }
  const rootStat = await fsp.lstat(layoutRoot).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("DMG layout root is missing or unsafe");
  }

  const entries = (await fsp.readdir(layoutRoot)).sort();
  if (entries.length !== EXPECTED_ENTRIES.length
      || entries.some((entry, index) => entry !== EXPECTED_ENTRIES[index])) {
    throw new Error(`DMG layout entries are invalid: ${entries.join(", ") || "none"}`);
  }

  const appPath = path.join(layoutRoot, DMG_APP_NAME);
  const appStat = await fsp.lstat(appPath).catch(() => null);
  if (!appStat || appStat.isSymbolicLink() || !appStat.isDirectory()) {
    throw new Error("DMG app must be a real directory");
  }

  const applicationsLink = path.join(layoutRoot, DMG_APPLICATIONS_LINK_NAME);
  const linkStat = await fsp.lstat(applicationsLink).catch(() => null);
  if (!linkStat?.isSymbolicLink()) {
    throw new Error("DMG Applications entry must be a symbolic link");
  }
  const linkTarget = await fsp.readlink(applicationsLink);
  if (linkTarget !== DMG_APPLICATIONS_LINK_TARGET) {
    throw new Error("DMG Applications link target is invalid");
  }

  return {
    schemaVersion: "podcast-visualizer-dmg-layout-v1",
    appName: DMG_APP_NAME,
    applicationsLink: DMG_APPLICATIONS_LINK_TARGET
  };
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [layoutInput] = process.argv.slice(2);
  if (!layoutInput) throw new Error("usage: dmg-layout.mjs <absolute-layout-root>");
  process.stdout.write(`${JSON.stringify(await validateDMGLayout(layoutInput))}\n`);
}

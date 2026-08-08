import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { hashFile } from "./files.js";

export function isIgnorableRuntimeMetadata(name) {
  return name === ".DS_Store";
}

export async function runtimeTreeEvidence(directory, { label = "runtime" } = {}) {
  const root = path.resolve(directory);
  const rootStat = await fsp.lstat(root).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${label} is not a real directory`);
  }

  const entries = [];
  async function walk(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      if (isIgnorableRuntimeMetadata(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await walk(absolute);
      else entries.push({ absolute, relative, entry });
    }
  }
  await walk(root);

  const digest = createHash("sha256");
  let bytes = 0;
  let files = 0;
  let symlinks = 0;
  for (const item of entries.sort((left, right) => left.relative.localeCompare(right.relative))) {
    if (item.entry.isSymbolicLink()) {
      const target = await fsp.readlink(item.absolute);
      const resolved = await fsp.realpath(item.absolute).catch(() => null);
      const relative = resolved ? path.relative(root, resolved) : "..";
      if (path.isAbsolute(target) || !resolved || relative === ".."
          || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`${label} contains an unsafe symlink: ${item.relative}`);
      }
      digest.update(`L\0${item.relative}\0${target}\0`);
      symlinks += 1;
    } else if (item.entry.isFile()) {
      const stat = await fsp.lstat(item.absolute);
      digest.update(`F\0${item.relative}\0${stat.size}\0${await hashFile(item.absolute)}\0`);
      bytes += stat.size;
      files += 1;
    } else {
      throw new Error(`${label} contains an unsupported entry: ${item.relative}`);
    }
  }
  return { files, symlinks, bytes, sha256: digest.digest("hex") };
}

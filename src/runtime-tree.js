import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { hashFile } from "./files.js";

export function isIgnorableRuntimeMetadata(name) {
  return name === ".DS_Store";
}

const TRANSIENT_READ_ERRORS = new Set(["EAGAIN", "EBUSY", "ETIMEDOUT"]);

async function hashRuntimeFile(filePath, hash, maximumAttempts = 3) {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await hash(filePath);
    } catch (error) {
      if (!TRANSIENT_READ_ERRORS.has(error?.code) || attempt === maximumAttempts) throw error;
    }
  }
  throw new Error("runtime file hashing exhausted its retry bound");
}

export async function runtimeTreeEvidence(directory, {
  label = "runtime",
  hash = hashFile
} = {}) {
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

  const ordered = entries.sort((left, right) => left.relative.localeCompare(right.relative));
  const records = new Array(ordered.length);
  let cursor = 0;
  async function inspectNext() {
    while (cursor < ordered.length) {
      const index = cursor;
      cursor += 1;
      const item = ordered[index];
      if (item.entry.isSymbolicLink()) {
        const target = await fsp.readlink(item.absolute);
        const resolved = await fsp.realpath(item.absolute).catch(() => null);
        const relative = resolved ? path.relative(root, resolved) : "..";
        if (path.isAbsolute(target) || !resolved || relative === ".."
            || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error(`${label} contains an unsafe symlink: ${item.relative}`);
        }
        records[index] = { kind: "link", relative: item.relative, target };
      } else if (item.entry.isFile()) {
        const stat = await fsp.lstat(item.absolute);
        records[index] = {
          kind: "file",
          relative: item.relative,
          bytes: stat.size,
          sha256: await hashRuntimeFile(item.absolute, hash)
        };
      } else {
        throw new Error(`${label} contains an unsupported entry: ${item.relative}`);
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(8, ordered.length) },
    () => inspectNext()
  ));

  const digest = createHash("sha256");
  let bytes = 0;
  let files = 0;
  let symlinks = 0;
  for (const record of records) {
    if (record.kind === "link") {
      digest.update(`L\0${record.relative}\0${record.target}\0`);
      symlinks += 1;
    } else {
      digest.update(`F\0${record.relative}\0${record.bytes}\0${record.sha256}\0`);
      bytes += record.bytes;
      files += 1;
    }
  }
  return { files, symlinks, bytes, sha256: digest.digest("hex") };
}

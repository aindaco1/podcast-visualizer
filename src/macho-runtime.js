import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function inspectPortableMachOFiles(directory, { label = "runtime" } = {}) {
  const root = path.resolve(directory);
  const candidates = [];
  async function walk(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        if (relative === "python/bin/python3.13" || /\.(?:so|dylib)$/.test(relative)) {
          candidates.push({ absolute, relative });
        }
      }
    }
  }
  await walk(root);

  let inspected = 0;
  for (const item of candidates) {
    const result = await run("/usr/bin/otool", ["-L", item.absolute], { maxBuffer: 2 * 1024 * 1024 })
      .catch((error) => ({ stdout: "", error }));
    if (result.error) continue;
    inspected += 1;
    for (const line of result.stdout.split("\n").slice(1)) {
      const dependency = line.trim().split(" ")[0];
      if (dependency.startsWith("/opt/homebrew/") || dependency.startsWith("/usr/local/")
          || dependency.includes("Mobile Documents")) {
        throw new Error(`nonportable dependency in ${label} ${item.relative}: ${dependency}`);
      }
    }
  }
  return inspected;
}

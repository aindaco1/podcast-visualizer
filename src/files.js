import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliError, EXIT } from "./errors.js";

export const MAXIMUM_SOURCE_BYTES = 16 * 1024 * 1024 * 1024;

export async function regularFile(inputPath, label = "file") {
  const absolute = path.resolve(String(inputPath ?? ""));
  let stat;
  let linkStat;
  try {
    linkStat = await fsp.lstat(absolute);
    stat = await fsp.stat(absolute);
  } catch {
    throw new CliError(`${label} does not exist`, { exitCode: EXIT.usage });
  }
  if (linkStat.isSymbolicLink() || !stat.isFile()) {
    throw new CliError(`${label} must be a regular file, not a symlink`, { exitCode: EXIT.usage });
  }
  if (stat.size < 1 || stat.size > MAXIMUM_SOURCE_BYTES) {
    throw new CliError(`${label} size is outside the supported range`, { exitCode: EXIT.usage });
  }
  return { absolute, stat };
}

export function safeNewProjectPath(projectPath) {
  const absolute = path.resolve(String(projectPath ?? ""));
  const parsed = path.parse(absolute);
  const home = path.resolve(os.homedir());
  if (!projectPath || absolute === parsed.root || absolute === home) {
    throw new CliError("--project must name a new, specific directory", { exitCode: EXIT.usage });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(path.basename(absolute))) {
    throw new CliError("project directory name is unsafe", { exitCode: EXIT.usage });
  }
  return absolute;
}

export async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function writeNewJson(filePath, json) {
  await writeNewFile(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

export async function writeNewFile(filePath, content, { mode = 0o600 } = {}) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fsp.writeFile(temporary, content, { flag: "wx", mode });
    await fsp.link(temporary, filePath);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

export async function copyNewFile(source, destination) {
  await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(destination, 0o600);
}

export function descendantPath(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliError("resolved path escapes or aliases the project root");
  }
  return candidate;
}

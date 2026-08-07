import fsp from "node:fs/promises";
import path from "node:path";

function escapes(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export async function validateExtractedRelease(extractionRoot, releaseName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(releaseName)) {
    throw new Error("release name is unsafe");
  }
  const resolvedExtraction = path.resolve(extractionRoot);
  const topLevel = await fsp.readdir(resolvedExtraction);
  if (topLevel.length !== 1 || topLevel[0] !== releaseName) {
    throw new Error("release archive must contain exactly its named top-level directory");
  }
  const releaseRoot = path.join(resolvedExtraction, releaseName);
  const rootStat = await fsp.lstat(releaseRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("release archive root is unsafe");
  }
  const realReleaseRoot = await fsp.realpath(releaseRoot);
  let files = 0;
  let directories = 1;
  let symlinks = 0;

  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fsp.readlink(absolute);
        const resolvedTarget = path.resolve(directory, target);
        if (!target || path.isAbsolute(target) || escapes(releaseRoot, resolvedTarget)) {
          throw new Error(`release archive contains an escaping symlink: ${path.relative(releaseRoot, absolute)}`);
        }
        const realTarget = await fsp.realpath(absolute).catch(() => null);
        if (!realTarget || escapes(realReleaseRoot, realTarget)) {
          throw new Error(`release archive contains an unsafe or dangling symlink: ${path.relative(releaseRoot, absolute)}`);
        }
        symlinks += 1;
      } else if (entry.isDirectory()) {
        directories += 1;
        await walk(absolute);
      } else if (entry.isFile()) {
        files += 1;
      } else {
        throw new Error(`release archive contains an unsupported entry: ${path.relative(releaseRoot, absolute)}`);
      }
    }
  }
  await walk(releaseRoot);
  if (files < 1) throw new Error("release archive is empty");
  return { releaseRoot, files, directories, symlinks };
}

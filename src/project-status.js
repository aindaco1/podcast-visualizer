import fsp from "node:fs/promises";

import { CliError } from "./errors.js";
import { descendantPath } from "./files.js";

async function regularMarker(projectRoot, ...segments) {
  const marker = descendantPath(projectRoot, ...segments);
  const stat = await fsp.lstat(marker).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CliError(`project stage marker is unsafe: ${segments.join("/")}`);
  }
  return true;
}

async function matchingMarker(projectRoot, directoryName, pattern) {
  const directory = descendantPath(projectRoot, directoryName);
  const stat = await fsp.lstat(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliError(`project stage directory is unsafe: ${directoryName}`);
  }
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CliError(`project stage marker is unsafe: ${directoryName}/${entry.name}`);
    }
    return true;
  }
  return false;
}

export async function detectProjectStage(projectRoot) {
  if (await matchingMarker(projectRoot, "renders", /^render_[a-f0-9]{24}\.json$/)) return "verified";
  if (await matchingMarker(projectRoot, "alignment", /^alignment_[a-f0-9]{24}-quality\.json$/)) return "aligned";
  if (await matchingMarker(projectRoot, "review", /^transcript_[a-f0-9]{24}-approved\.json$/)) return "approved";
  if (await regularMarker(projectRoot, "review", "draft.json")) return "review_required";
  if (await regularMarker(projectRoot, "prepare.json")) return "prepared";
  return "initialized";
}

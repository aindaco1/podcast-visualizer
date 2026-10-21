import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Both development and release bundles need the same production dependencies.
// Copy package contents; checkout-relative npm symlinks cannot ship in an app.
export async function stageCliPackages(cliInput) {
  if (!cliInput || !path.isAbsolute(cliInput)) throw new Error("CLI stage must be absolute");
  const stat = await fsp.lstat(cliInput);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("CLI stage must be a real directory");
  const cli = await fsp.realpath(cliInput);
  if (cli === path.parse(cli).root) throw new Error("CLI stage cannot be a filesystem root");
  let packageRoot = cli;
  for (const segment of ["node_modules", "@dustwave"]) {
    packageRoot = path.join(packageRoot, segment);
    const existing = await fsp.lstat(packageRoot).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new Error("CLI package parent must be a real directory");
    }
    if (!existing) await fsp.mkdir(packageRoot);
  }
  for (const name of ["timed-text", "node-core"]) {
    const destination = path.join(packageRoot, name);
    if (await fsp.lstat(destination).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    })) throw new Error(`CLI package stage already exists: ${name}`);
    await fsp.cp(path.join(ROOT, "shared/dust-wave-platform/packages", name), destination, {
      recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("usage: stage-cli-packages.mjs <absolute-cli-stage>");
  await stageCliPackages(process.argv[2]);
}

import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_MANIFEST = path.join(ROOT, "resources", "runtime-manifests", "alignment-macos-arm64.json");
const DESTINATION = path.join(ROOT, "runtime", "macos-arm64", "alignment");
const OUTPUT_MANIFEST = path.join(ROOT, "runtime", "macos-arm64", "alignment-manifest.json");
const PYTHON_ROOT = process.env.PODCAST_VISUALIZER_PYTHON_ROOT
  || "/Users/aindaco1/.local/share/uv/python/cpython-3.13.13-macos-aarch64-none";
const SITE_PACKAGES = process.env.PODCAST_VISUALIZER_SITE_PACKAGES
  || path.join(ROOT, "alignment-runner", ".venv", "lib", "python3.13", "site-packages");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function assertDirectory(directory, label) {
  const stat = await fsp.lstat(directory).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} is not a real directory`);
}

function includeSitePackage(source) {
  const name = path.basename(source);
  return name !== "__pycache__" && !name.endsWith(".pyc")
    && name !== "_editable_impl_dustwave_alignment_runner.pth"
    && name !== "_virtualenv.pth" && name !== "_virtualenv.py";
}

async function walk(directory, root = directory) {
  const entries = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) entries.push(...await walk(absolute, root));
    else entries.push({ absolute, relative, entry });
  }
  return entries;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  const handle = await fsp.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest("hex");
}

async function treeEvidence(directory) {
  const hash = createHash("sha256");
  let bytes = 0;
  let files = 0;
  let symlinks = 0;
  for (const item of (await walk(directory)).sort((left, right) => left.relative.localeCompare(right.relative))) {
    if (item.entry.isSymbolicLink()) {
      const target = await fsp.readlink(item.absolute);
      const resolved = path.resolve(path.dirname(item.absolute), target);
      const relative = path.relative(directory, resolved);
      if (path.isAbsolute(target) || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`alignment runtime contains an unsafe symlink: ${item.relative}`);
      }
      hash.update(`L\0${item.relative}\0${target}\0`);
      symlinks += 1;
    } else if (item.entry.isFile()) {
      const stat = await fsp.lstat(item.absolute);
      hash.update(`F\0${item.relative}\0${stat.size}\0${await hashFile(item.absolute)}\0`);
      bytes += stat.size;
      files += 1;
    } else {
      throw new Error(`alignment runtime contains an unsupported entry: ${item.relative}`);
    }
  }
  return { files, symlinks, bytes, sha256: hash.digest("hex") };
}

async function packageInventory(sitePackages) {
  const packages = [];
  for (const name of await fsp.readdir(sitePackages)) {
    if (!name.endsWith(".dist-info")) continue;
    const metadata = await fsp.readFile(path.join(sitePackages, name, "METADATA"), "utf8").catch(() => "");
    const packageName = /^Name:\s*(.+)$/mi.exec(metadata)?.[1]?.trim();
    const version = /^Version:\s*(.+)$/mi.exec(metadata)?.[1]?.trim();
    if (!packageName || !version) throw new Error(`package metadata is incomplete: ${name}`);
    packages.push({ name: packageName, version });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

async function inspectMachODependencies(directory) {
  const candidates = (await walk(directory)).filter(({ relative }) =>
    relative === "python/bin/python3.13" || /\.(?:so|dylib)$/.test(relative));
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
        throw new Error(`nonportable dependency in ${item.relative}: ${dependency}`);
      }
    }
  }
  return inspected;
}

await assertDirectory(PYTHON_ROOT, "managed Python runtime");
await assertDirectory(SITE_PACKAGES, "locked alignment site-packages");
for (const target of [DESTINATION, OUTPUT_MANIFEST]) {
  if (await fsp.lstat(target).catch(() => null)) throw new Error(`refusing to replace existing ${target}`);
}

const source = JSON.parse(await fsp.readFile(SOURCE_MANIFEST, "utf8"));
if (source.schemaVersion !== "podcast-visualizer-alignment-runtime-source-v1"
    || source.platform !== "macos-arm64" || source.pythonVersion !== "3.13.13"
    || source.whisperxVersion !== "3.8.6" || !/^[a-f0-9]{40}$/.test(source.runnerRevision)
    || !source.pythonLicense.url.startsWith("https://raw.githubusercontent.com/python/cpython/v3.13.13/")
    || !Number.isSafeInteger(source.pythonLicense.bytes) || !/^[a-f0-9]{64}$/.test(source.pythonLicense.sha256)
    || !source.punktTab.url.startsWith("https://raw.githubusercontent.com/nltk/nltk_data/")
    || !Number.isSafeInteger(source.punktTab.bytes) || !/^[a-f0-9]{64}$/.test(source.punktTab.sha256)) {
  throw new Error("alignment runtime source manifest is invalid");
}

const stageRoot = path.join(ROOT, "runtime", "macos-arm64", `.alignment-stage-${process.pid}-${randomBytes(6).toString("hex")}`);
try {
  await fsp.mkdir(stageRoot, { recursive: false, mode: 0o700 });
  await fsp.cp(PYTHON_ROOT, path.join(stageRoot, "python"), {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true
  });
  const stagedSitePackages = path.join(stageRoot, "site-packages");
  await fsp.cp(SITE_PACKAGES, stagedSitePackages, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter: includeSitePackage
  });
  await fsp.copyFile(path.join(ROOT, "alignment-runtime", "sitecustomize.py"), path.join(stagedSitePackages, "sitecustomize.py"));

  const licenseResponse = await fetch(source.pythonLicense.url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000)
  });
  if (!licenseResponse.ok) throw new Error(`CPython license download failed (${licenseResponse.status})`);
  const license = Buffer.from(await licenseResponse.arrayBuffer());
  if (license.length !== source.pythonLicense.bytes || digest(license) !== source.pythonLicense.sha256) {
    throw new Error("CPython license checksum mismatch");
  }
  await fsp.writeFile(path.join(stageRoot, "LICENSE.Python"), license, { flag: "wx", mode: 0o600 });

  const response = await fetch(source.punktTab.url, { redirect: "error", signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) throw new Error(`punkt_tab download failed (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length !== source.punktTab.bytes || digest(archive) !== source.punktTab.sha256) {
    throw new Error("punkt_tab checksum mismatch");
  }
  const archivePath = path.join(stageRoot, "punkt_tab.zip");
  await fsp.writeFile(archivePath, archive, { flag: "wx", mode: 0o600 });
  const listing = await run("/usr/bin/unzip", ["-Z1", archivePath], { maxBuffer: 2 * 1024 * 1024 });
  const entries = listing.stdout.trim().split("\n");
  if (!entries.length || entries.some((entry) => !/^punkt_tab\/[A-Za-z0-9._\/-]*$/.test(entry)
      || entry.includes("../") || entry.startsWith("/"))) {
    throw new Error("punkt_tab archive contains an unsafe path");
  }
  const tokenizers = path.join(stageRoot, "nltk_data", "tokenizers");
  await fsp.mkdir(tokenizers, { recursive: true, mode: 0o700 });
  await run("/usr/bin/ditto", ["-x", "-k", archivePath, tokenizers], { maxBuffer: 2 * 1024 * 1024 });
  await fsp.unlink(archivePath);

  const directPython = path.join(stageRoot, "python", "bin", "python3.13");
  const version = await run(directPython, ["-I", "-c", "import platform; print(platform.python_version())"]);
  if (version.stdout.trim() !== source.pythonVersion) throw new Error("staged Python version does not match");
  const packages = await packageInventory(stagedSitePackages);
  if (!packages.some((item) => item.name.toLowerCase() === "whisperx" && item.version === source.whisperxVersion)) {
    throw new Error("staged WhisperX package does not match");
  }
  const libomp = path.join(stagedSitePackages, "torch", "lib", "libomp.dylib");
  await run("/usr/bin/install_name_tool", ["-id", "@rpath/libomp.dylib", libomp], { maxBuffer: 2 * 1024 * 1024 });
  await run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", libomp], { maxBuffer: 2 * 1024 * 1024 });
  const machoFilesInspected = await inspectMachODependencies(stageRoot);
  const tree = await treeEvidence(stageRoot);
  const body = {
    schemaVersion: "podcast-visualizer-alignment-runtime-v1",
    platform: source.platform,
    minimumMacOS: "13.5",
    pythonVersion: source.pythonVersion,
    pythonProvider: source.pythonProvider,
    whisperxVersion: source.whisperxVersion,
    runnerRevision: source.runnerRevision,
    pythonLicense: source.pythonLicense,
    sourceManifestSha256: digest(Buffer.from(`${JSON.stringify(source)}\n`)),
    punktTab: source.punktTab,
    tree,
    machoFilesInspected,
    packages
  };
  const manifest = { ...body, manifestSha256: digest(Buffer.from(`${JSON.stringify(body)}\n`)) };
  await fsp.rename(stageRoot, DESTINATION);
  await fsp.writeFile(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${DESTINATION}\n`);
} catch (error) {
  await fsp.rm(stageRoot, { recursive: true, force: true });
  throw error;
}

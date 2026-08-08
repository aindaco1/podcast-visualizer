import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const [appInput] = process.argv.slice(2);
if (!appInput) throw new Error("usage: verify-app.mjs <Podcast Visualizer.app>");
const app = path.resolve(appInput);
if (path.basename(app) !== "Podcast Visualizer.app") throw new Error("app bundle name is invalid");
const contents = path.join(app, "Contents");
const cli = path.join(contents, "Resources", "CLI");
const required = [
  "Contents/Resources/AppIcon.icns",
  "Contents/Info.plist",
  "Contents/MacOS/PodcastVisualizer",
  "Contents/Resources/CLI/bin/dustwave-video",
  "Contents/Resources/CLI/bin/dustwave-video.mjs",
  "Contents/Resources/CLI/runtime/macos-arm64/bin/node",
  "Contents/Resources/CLI/runtime/macos-arm64/bin/ffmpeg",
  "Contents/Resources/CLI/runtime/macos-arm64/bin/ffprobe",
  "Contents/Resources/CLI/runtime/macos-arm64/bin/podcast-visualizer-speech",
  "Contents/Resources/CLI/resources/brand/dust-wave-v1.json",
  "Contents/Resources/CLI/review-ui/index.html",
  "Contents/Resources/CLI/node_modules/@dustwave/timed-text/package.json",
  "Contents/Resources/CLI/alignment-runner/pyproject.toml",
  "Contents/Resources/CLI/LICENSE",
  "Contents/Resources/CLI/THIRD_PARTY_NOTICES.md"
];

for (const relative of required) {
  const target = path.join(app, relative);
  const stat = await fsp.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`app is missing a safe required file: ${relative}`);
  }
}

let files = 0;
let symlinks = 0;
let runtimeRoots = 0;
async function walk(directory) {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const relative = path.relative(app, target);
    if (relative.endsWith(path.join("runtime", "macos-arm64"))) runtimeRoots += 1;
    if (entry.isSymbolicLink()) {
      const link = await fsp.readlink(target);
      const resolved = path.resolve(directory, link);
      const containment = path.relative(app, resolved);
      const real = await fsp.realpath(target).catch(() => null);
      if (!link || path.isAbsolute(link) || containment === ".." || containment.startsWith(`..${path.sep}`)
          || !real || path.relative(app, real).startsWith(`..${path.sep}`)) {
        throw new Error(`app contains an unsafe symlink: ${relative}`);
      }
      symlinks += 1;
    } else if (entry.isDirectory()) {
      await walk(target);
    } else if (entry.isFile()) {
      files += 1;
    } else {
      throw new Error(`app contains an unsupported entry: ${relative}`);
    }
  }
}
await walk(app);
if (runtimeRoots !== 1) throw new Error(`app must contain exactly one runtime closure; found ${runtimeRoots}`);

const launcher = path.join(cli, "bin", "dustwave-video");
const help = await run(launcher, ["--help"], { cwd: cli, maxBuffer: 1024 * 1024 });
if (!help.stdout.startsWith("Podcast Visualizer")) throw new Error("packaged CLI launcher failed");
process.stdout.write(`${JSON.stringify({ app, files, symlinks, runtimeRoots })}\n`);

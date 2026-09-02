import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ROOT_DOCUMENTS = [
  "README.md",
  "ROADMAP.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md"
];

async function markdownDocuments() {
  const documents = [...ROOT_DOCUMENTS];
  const directories = ["docs"];
  while (directories.length > 0) {
    const relativeDirectory = directories.pop();
    const entries = await fsp.readdir(path.join(REPOSITORY_ROOT, relativeDirectory), {
      withFileTypes: true
    });
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) directories.push(relative);
      else if (entry.isFile() && entry.name.endsWith(".md")) documents.push(relative);
    }
  }
  return documents.sort();
}

test("public documentation keeps local links inside the repository and resolvable", async () => {
  for (const relativeDocument of await markdownDocuments()) {
    const documentPath = path.join(REPOSITORY_ROOT, relativeDocument);
    const markdown = await fsp.readFile(documentPath, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
      const fileTarget = decodeURIComponent(rawTarget.split("#", 1)[0]);
      if (!fileTarget) continue;
      const resolved = path.resolve(path.dirname(documentPath), fileTarget);
      const relative = path.relative(REPOSITORY_ROOT, resolved);
      assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        `${relativeDocument} contains an escaping link: ${rawTarget}`);
      const stat = await fsp.stat(resolved).catch(() => null);
      assert.ok(stat?.isFile(), `${relativeDocument} contains a missing file link: ${rawTarget}`);
    }
  }
});

test("stable release metadata and the version-matched public DMG remain explicit", async () => {
  const [pkg, lock, info, readme, changelog] = await Promise.all([
    fsp.readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8").then(JSON.parse),
    fsp.readFile(path.join(REPOSITORY_ROOT, "package-lock.json"), "utf8").then(JSON.parse),
    fsp.readFile(path.join(REPOSITORY_ROOT, "macos/Sources/PodcastVisualizerApp/Info.plist"), "utf8"),
    fsp.readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8"),
    fsp.readFile(path.join(REPOSITORY_ROOT, "CHANGELOG.md"), "utf8")
  ]);
  const version = pkg.version;
  const escapedVersion = version.replaceAll(".", "\\.");
  const releaseNotes = await fsp.readFile(
    path.join(REPOSITORY_ROOT, "docs", "releases", `${version}.md`),
    "utf8"
  );

  assert.equal(lock.version, version);
  assert.equal(lock.packages[""].version, version);
  assert.match(info, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${escapedVersion}</string>`));
  assert.ok(readme.includes(`current stable release is \`${version}\``));
  assert.ok(readme.includes(
    `https://github.com/aindaco1/podcast-visualizer/releases/download/v${version}/Podcast-Visualizer-${version}-arm64.dmg`
  ));
  assert.match(changelog, new RegExp(`^## ${escapedVersion} — `, "m"));
  assert.equal(releaseNotes.split("\n", 1)[0], `# Podcast Visualizer ${version}`);
  assert.ok(releaseNotes.includes(`Status: released`));
});

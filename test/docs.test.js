import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DOCUMENTS = [
  "README.md",
  "docs/cli-app-contract.md",
  "docs/implementation-plan.md",
  "docs/editor-compatibility.md",
  "docs/macos-app-rc-plan.md",
  "docs/testing/macos-27-readiness.md",
  "docs/testing/1.2.4-dry-audit.md",
  "docs/testing/1.3.0-confidence-calibration.md",
  "docs/testing/1.3.0-performance-baseline.md",
  "docs/testing/1.3.0-dry-audit.md",
  "docs/releases/1.3.0.md",
  "docs/testing/user-flow-regressions.md"
];

test("public documentation keeps local links inside the repository and resolvable", async () => {
  for (const relativeDocument of DOCUMENTS) {
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

test("source candidate metadata and the latest public DMG remain explicit", async () => {
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
  assert.ok(readme.includes(`current source release candidate is \`${version}\``));
  assert.ok(readme.includes(
    "https://github.com/aindaco1/podcast-visualizer/releases/download/v1.2.4/Podcast-Visualizer-1.2.4-arm64.dmg"
  ));
  assert.match(changelog, new RegExp(`^## ${escapedVersion} — `, "m"));
  assert.equal(releaseNotes.split("\n", 1)[0], `# Podcast Visualizer ${version}`);
});

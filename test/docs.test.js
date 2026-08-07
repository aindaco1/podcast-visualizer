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
  "docs/macos-app-rc-plan.md"
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

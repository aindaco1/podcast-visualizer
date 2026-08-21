import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeProject, loadProject, validateProjectManifest } from "../src/project.js";

async function fixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-visualizer-test-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.m4a");
  await fsp.writeFile(source, Buffer.from("rights-cleared-test-audio-placeholder"));
  return { root, source, project: path.join(root, "proof") };
}

test("initializes and validates an immutable project", async (context) => {
  const item = await fixture(context);
  const initialized = await initializeProject({
    source: item.source,
    project: item.project,
    clip: "00:01:58-00:03:25"
  });
  assert.equal(initialized.manifest.state, "initialized");
  assert.equal(initialized.manifest.clip.durationMs, 87000);
  assert.equal((await fsp.stat(path.join(item.project, "project.json"))).mode & 0o777, 0o600);
  await fsp.unlink(item.source);
  const loaded = await loadProject(item.project);
  assert.deepEqual(loaded.manifest, initialized.manifest);
  assert.equal(loaded.sourcePath, path.join(item.project, initialized.manifest.source.relativePath));
});

test("allows a Finder-style project directory name containing spaces", async (context) => {
  const item = await fixture(context);
  const project = path.join(item.root, "Podcast Visualizer Project");
  const initialized = await initializeProject({
    source: item.source,
    project,
    clip: "00:00-00:01"
  });

  assert.equal(initialized.projectRoot, project);
  assert.equal((await loadProject(project)).manifest.projectId, initialized.manifest.projectId);
});

test("rejects unsafe project names with private recovery guidance", async (context) => {
  const item = await fixture(context);
  const project = path.join(item.root, "Podcast Visualizer Project ");

  await assert.rejects(
    initializeProject({ source: item.source, project, clip: "00:00-00:01" }),
    (error) => {
      assert.equal(error.message, "project directory name is unsafe");
      assert.equal(error.diagnosticCode, "project_name_unsafe");
      assert.match(error.hint, /source media was preserved/i);
      assert.match(error.hint, /no project was created/i);
      assert.doesNotMatch(error.hint, /\/Users\//);
      return true;
    }
  );
  await assert.rejects(fsp.access(project));
});

test("does not overwrite an existing project", async (context) => {
  const item = await fixture(context);
  await fsp.mkdir(item.project);
  await assert.rejects(
    initializeProject({ source: item.source, project: item.project, clip: "00:00-00:01" }),
    /already exists/
  );
});

test("detects manifest and source tampering", async (context) => {
  const item = await fixture(context);
  const initialized = await initializeProject({
    source: item.source,
    project: item.project,
    clip: "00:00-00:01"
  });
  assert.throws(() => validateProjectManifest({ ...initialized.manifest, state: "rendered" }), /hash/);
  await fsp.appendFile(path.join(item.project, initialized.manifest.source.relativePath), "changed");
  await assert.rejects(loadProject(item.project), /changed/);
});

test("rejects source symlinks", async (context) => {
  const item = await fixture(context);
  const link = path.join(item.root, "link.m4a");
  await fsp.symlink(item.source, link);
  await assert.rejects(
    initializeProject({ source: link, project: item.project, clip: "00:00-00:01" }),
    /regular file, not a symlink/
  );
});

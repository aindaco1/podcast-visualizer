import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadProjectBranding, PROJECT_BRANDING_EDIT_SCHEMA, PROJECT_BRANDING_WORKSPACE_SCHEMA,
  saveProjectBranding
} from "../src/project-branding.js";
import { initializeProject } from "../src/project.js";

const VALID_LOGO = new URL("../resources/app-icon/podcast-visualizer-app-icon-v1.png", import.meta.url);

async function fixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-branding-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.wav");
  await fsp.writeFile(source, "local audio");
  const project = path.join(root, "project");
  await initializeProject({ source, project, clip: "00:00:00.000-00:00:01.000" });
  return { root, project };
}

async function writeEdit(root, value) {
  const input = path.join(root, `branding-${Math.random().toString(16).slice(2)}.json`);
  await fsp.writeFile(input, JSON.stringify(value));
  return input;
}

function edit(overrides = {}) {
  return {
    schemaVersion: PROJECT_BRANDING_EDIT_SCHEMA,
    podcastName: "The Local Show",
    organizationName: "Acme Media",
    showSpeakerNames: true,
    logoAction: { action: "keep" },
    ...overrides
  };
}

test("loads defaults and persists project-specific names", async (context) => {
  const { root, project } = await fixture(context);
  const defaults = await loadProjectBranding(project);
  assert.equal(defaults.schemaVersion, PROJECT_BRANDING_WORKSPACE_SCHEMA);
  assert.equal(defaults.podcastName, "Dust Wave Podcast");
  assert.equal(defaults.hasSavedSettings, false);
  const saved = await saveProjectBranding({
    projectPath: project,
    inputPath: await writeEdit(root, edit()),
    savedAt: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(saved.podcastName, "The Local Show");
  assert.equal(saved.organizationName, "Acme Media");
  assert.equal(saved.hasSavedSettings, true);
  assert.deepEqual(await loadProjectBranding(project), saved);
});

test("copies a bounded PNG into an immutable hash-named project asset", async (context) => {
  const { root, project } = await fixture(context);
  const logo = path.join(root, "logo.png");
  await fsp.copyFile(VALID_LOGO, logo);
  const saved = await saveProjectBranding({
    projectPath: project,
    inputPath: await writeEdit(root, edit({ logoAction: { action: "replace", sourcePath: logo } }))
  });
  assert.equal(saved.logo.width, 1024);
  assert.equal(saved.logo.height, 1024);
  assert.match(saved.logo.relativePath, /^branding\/assets\/logo_[a-f0-9]{64}\.png$/);
  assert.deepEqual(await fsp.readFile(saved.logo.path), await fsp.readFile(VALID_LOGO));
  await fsp.unlink(logo);
  assert.deepEqual(await loadProjectBranding(project), saved);

  const removed = await saveProjectBranding({
    projectPath: project,
    inputPath: await writeEdit(root, edit({ logoAction: { action: "remove" } }))
  });
  assert.equal(removed.logo, null);
  assert.equal((await fsp.stat(saved.logo.path)).isFile(), true);
});

test("rejects unsafe edits, image sources, and mutable settings targets", async (context) => {
  const { root, project } = await fixture(context);
  await assert.rejects(
    saveProjectBranding({
      projectPath: project,
      inputPath: await writeEdit(root, { ...edit(), unexpected: true })
    }),
    /unknown field/
  );
  const logo = path.join(root, "logo.png");
  const logoTarget = path.join(root, "logo-target.png");
  await fsp.copyFile(VALID_LOGO, logoTarget);
  await fsp.symlink(logoTarget, logo);
  await assert.rejects(
    saveProjectBranding({
      projectPath: project,
      inputPath: await writeEdit(root, edit({ logoAction: { action: "replace", sourcePath: logo } }))
    }),
    /not a symlink/
  );

  await fsp.mkdir(path.join(project, "branding"));
  const outside = path.join(root, "outside.json");
  await fsp.writeFile(outside, "preserve me");
  await fsp.symlink(outside, path.join(project, "branding", "settings.json"));
  await assert.rejects(loadProjectBranding(project), /settings are unsafe/);
  assert.equal(await fsp.readFile(outside, "utf8"), "preserve me");
});

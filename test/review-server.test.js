import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReviewDraft, defaultReviewSpeakers } from "../src/review.js";
import { createReviewServer } from "../src/review-server.js";
import { buildSpeakerTurns } from "../src/speaker-turns.js";

const AUDIO_HASH = "c".repeat(64);
const PROJECT_ID = "project_cccccccccccccccc_20260807010203";

async function setup(context) {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "podcast-review-server-"));
  context.after(() => fsp.rm(projectRoot, { recursive: true, force: true }));
  const audioPath = path.join(projectRoot, "audio.wav");
  const audio = Buffer.alloc(1024 * 1024 + 16, "x");
  audio.write("0123456789", 0);
  audio.write("cdef", audio.length - 4);
  await fsp.writeFile(audioPath, audio);
  const turns = buildSpeakerTurns({
    sourceAudioSha256: AUDIO_HASH,
    durationMs: 4000,
    engine: {
      name: "fluidaudio-offline", version: "0.15.5", model: "fixture",
      modelVersion: "fixture", settingsVersion: "fixture-v1"
    },
    rawTurns: [
      { cluster: "a", startsAtMs: 0, endsAtMs: 2000, confidence: 1 },
      { cluster: "b", startsAtMs: 2000, endsAtMs: 4000, confidence: 1 }
    ]
  });
  const draft = buildReviewDraft({
    sourceAudioSha256: AUDIO_HASH,
    durationMs: 4000,
    transcription: { engine: "parakeet", version: "0.15.5", model: "fixture", modelVersion: "fixture" },
    cues: [
      { startsAtMs: 0, endsAtMs: 1800, textMarkdown: "Hello there." },
      { startsAtMs: 2200, endsAtMs: 4000, textMarkdown: "General Kenobi." }
    ],
    speakerTurns: turns
  });
  const server = await createReviewServer({
    projectRoot,
    projectId: PROJECT_ID,
    sourceAudioSha256: AUDIO_HASH,
    draft,
    audioPath,
    audioContentType: "audio/wav",
    idleTimeoutMs: 30000,
    approvedAt: () => "2026-08-07T00:00:00.000Z"
  });
  context.after(() => server.close().catch(() => {}));
  return { projectRoot, draft, server };
}

async function session(server) {
  const token = new URL(server.url).hash.slice("#token=".length);
  const response = await fetch(`${server.origin}/api/session`, {
    method: "POST",
    headers: { Origin: server.origin, "X-Review-Token": token }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.audioToken, /^[A-Za-z0-9_-]{40,}$/);
  return { cookie: response.headers.get("set-cookie").split(";", 1)[0], audioToken: body.audioToken };
}

test("requires the fragment token and expected origin to create a session", async (context) => {
  const { server } = await setup(context);
  const page = await fetch(server.origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await page.text(), /id="confirm-speakers"/);
  const app = await (await fetch(`${server.origin}/app.js`)).text();
  assert.match(app, /addSpeaker/);
  assert.match(app, /MAXIMUM_REVIEW_SPEAKERS = 99/);
  const absent = await fetch(`${server.origin}/api/draft`);
  assert.equal(absent.status, 401);
  const forged = await fetch(`${server.origin}/api/session`, {
    method: "POST", headers: { Origin: "https://attacker.invalid", "X-Review-Token": "wrong" }
  });
  assert.equal(forged.status, 403);
  assert.equal((await session(server)).cookie.startsWith("pv_review="), true);
});

test("serves bounded audio ranges only to the review session", async (context) => {
  const { server } = await setup(context);
  const { cookie, audioToken } = await session(server);
  const response = await fetch(`${server.origin}/api/audio`, {
    headers: { Cookie: cookie, Range: "bytes=2-5" }
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "2345");
  assert.equal(response.headers.get("content-range"), `bytes 2-5/${1024 * 1024 + 16}`);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  const tokenResponse = await fetch(`${server.origin}/api/audio?token=${audioToken}`, {
    headers: { Range: "bytes=0-1" }
  });
  assert.equal(tokenResponse.status, 206);
  assert.equal(await tokenResponse.text(), "01");
  const rejected = await fetch(`${server.origin}/api/audio?token=wrong`, {
    headers: { Range: "bytes=0-1" }
  });
  assert.equal(rejected.status, 401);
  const suffix = await fetch(`${server.origin}/api/audio`, {
    headers: { Cookie: cookie, Range: "bytes=-4" }
  });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "cdef");
  const head = await fetch(`${server.origin}/api/audio`, {
    method: "HEAD", headers: { Cookie: cookie }
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(1024 * 1024 + 16));
  const bounded = await fetch(`${server.origin}/api/audio`, {
    headers: { Cookie: cookie, Range: "bytes=0-9999999" }
  });
  assert.equal(bounded.status, 206);
  assert.equal(bounded.headers.get("content-length"), String(1024 * 1024));
  assert.equal((await bounded.arrayBuffer()).byteLength, 1024 * 1024);
  const invalid = await fetch(`${server.origin}/api/audio`, {
    headers: { Cookie: cookie, Range: "bytes=2000000-2000100" }
  });
  assert.equal(invalid.status, 416);
});

test("rejects cross-origin writes and approves an immutable revision", async (context) => {
  const { projectRoot, draft, server } = await setup(context);
  const { cookie } = await session(server);
  const cues = draft.cues.map((cue) => ({ ...cue, speakerConfirmed: true }));
  const speakers = defaultReviewSpeakers(draft.speakers).map((speaker, index) => (
    index === 0 ? { ...speaker, displayName: "Alonso" } : speaker
  ));
  const forged = await fetch(`${server.origin}/api/approve`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://attacker.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ speakers, cues })
  });
  assert.equal(forged.status, 403);

  const approved = await fetch(`${server.origin}/api/approve`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: server.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ speakers, cues })
  });
  assert.equal(approved.status, 201);
  const result = await approved.json();
  assert.match(result.transcriptId, /^transcript_[a-f0-9]{24}$/);
  await server.closed;
  const stored = JSON.parse(await fsp.readFile(path.join(projectRoot, "review", `${result.transcriptId}-approved.json`), "utf8"));
  assert.equal(stored.manifestSha256, result.manifestSha256);
  assert.equal(stored.speakers[0].displayName, "Alonso");
  const pointer = JSON.parse(await fsp.readFile(
    path.join(projectRoot, "review", "active-transcript.json"),
    "utf8"
  ));
  assert.equal(pointer.transcriptId, result.transcriptId);
  assert.equal(pointer.projectId, PROJECT_ID);
});

test("restores a saved browser working copy and rejects unexpected fields", async (context) => {
  const { draft, server } = await setup(context);
  const { cookie } = await session(server);
  const headers = { Cookie: cookie, Origin: server.origin, "Content-Type": "application/json" };
  const cues = draft.cues.map((cue, index) => ({
    ...cue, textMarkdown: index === 0 ? "Edited locally." : cue.textMarkdown
  }));
  const speakers = [
    ...defaultReviewSpeakers(draft.speakers),
    { id: "speaker-03", displayName: "Producer" }
  ];
  const rejected = await fetch(`${server.origin}/api/working`, {
    method: "PUT", headers, body: JSON.stringify({ speakers, cues, unexpected: true })
  });
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /fields are invalid/);
  const saved = await fetch(`${server.origin}/api/working`, {
    method: "PUT", headers, body: JSON.stringify({ speakers, cues })
  });
  assert.equal(saved.status, 200);
  const restored = await fetch(`${server.origin}/api/working`, { headers: { Cookie: cookie } });
  assert.equal(restored.status, 200);
  const body = await restored.json();
  assert.equal(body.hasWorkingCopy, true);
  assert.equal(body.cues[0].textMarkdown, "Edited locally.");
  assert.deepEqual(body.speakers, speakers);
});

test("bounds JSON bodies and does not expose stack traces", async (context) => {
  const { server } = await setup(context);
  const { cookie } = await session(server);
  const response = await fetch(`${server.origin}/api/working`, {
    method: "PUT",
    headers: {
      Cookie: cookie,
      Origin: server.origin,
      "Content-Type": "application/json"
    },
    body: "x".repeat(3 * 1024 * 1024)
  });
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /review-server\.js| at /);
});

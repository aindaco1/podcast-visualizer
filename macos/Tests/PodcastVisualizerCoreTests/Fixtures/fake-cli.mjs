#!/usr/bin/env node
import fs from "node:fs";

const mode = process.argv[2];
const progress = (sequence, event) => fs.writeSync(3, `${JSON.stringify({
  schemaVersion: "podcast-visualizer-progress-v1",
  sequence,
  command: "fixture",
  event,
  detail: {}
})}\n`);

progress(1, "command.started");
if (mode === "wait") {
  setInterval(() => {}, 1000);
} else if (mode === "oversized") {
  process.stdout.write("x".repeat(5 * 1024 * 1024));
} else if (mode === "environment") {
  progress(2, "command.completed");
  process.stdout.write(`${JSON.stringify({ modelsRoot: process.env.PODCAST_VISUALIZER_MODELS_ROOT })}\n`);
} else {
  progress(2, "command.completed");
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

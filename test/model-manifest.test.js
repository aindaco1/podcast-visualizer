import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveExternalModelsRoot, validateExternalAlignmentModel } from "../src/models.js";

const manifest = JSON.parse(await fsp.readFile(
  new URL("../resources/model-manifests/speaker-diarization-coreml.json", import.meta.url),
  "utf8"
));
const alignmentManifest = JSON.parse(await fsp.readFile(
  new URL("../resources/model-manifests/whisperx-en.json", import.meta.url),
  "utf8"
));

test("maps the pinned upstream diarization repo to FluidAudio's local cache folder", () => {
  assert.equal(manifest.model, "speaker-diarization");
  assert.equal(manifest.source.repository, "FluidInference/speaker-diarization-coreml");
  assert.match(manifest.source.revision, /^[a-f0-9]{40}$/);
  assert.equal(manifest.files.length, 22);
  assert.ok(manifest.files.some(({ path }) => path === "plda-parameters.json"));
});

test("pins the external English alignment model", () => {
  assert.equal(alignmentManifest.model, "WAV2VEC2_ASR_BASE_960H");
  assert.equal(alignmentManifest.modelVersion, alignmentManifest.files[0].sha256);
  assert.equal(alignmentManifest.source.url, "https://download.pytorch.org/torchaudio/models/wav2vec2_fairseq_base_ls960_asr_ls960.pth");
});

test("resolves an explicit app-owned external model root without accepting broad paths", () => {
  assert.equal(
    resolveExternalModelsRoot({
      PODCAST_VISUALIZER_MODELS_ROOT: "/Users/example/Library/Application Support/Podcast Visualizer/Models"
    }),
    "/Users/example/Library/Application Support/Podcast Visualizer/Models"
  );
  assert.throws(() => resolveExternalModelsRoot({ PODCAST_VISUALIZER_MODELS_ROOT: "relative/models" }));
  assert.throws(() => resolveExternalModelsRoot({ PODCAST_VISUALIZER_MODELS_ROOT: "/" }));
});

const installed = path.resolve(fileURLToPath(new URL("../models/alignment/whisperx-en", import.meta.url)));
const installedStat = await fsp.lstat(installed).catch(() => null);
test("verifies an installed English alignment model", {
  skip: !installedStat?.isDirectory(), timeout: 120_000
}, async () => {
  const result = await validateExternalAlignmentModel(installed);
  assert.equal(result.manifest.license, "MIT");
});

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliError, EXIT } from "./errors.js";
import { hashFile } from "./files.js";
import { BUNDLED_MODELS_ROOT, REPOSITORY_ROOT } from "./runtime.js";

const TRACKED_MANIFEST = path.join(
  REPOSITORY_ROOT, "resources", "model-manifests", "speaker-diarization-coreml.json"
);
const TRACKED_ALIGNMENT_MANIFEST = path.join(
  REPOSITORY_ROOT, "resources", "model-manifests", "whisperx-en.json"
);
export function resolveExternalModelsRoot(environment = process.env) {
  const configured = environment.PODCAST_VISUALIZER_MODELS_ROOT;
  if (configured === undefined) return path.join(REPOSITORY_ROOT, "models");
  if (typeof configured !== "string" || !path.isAbsolute(configured) || configured.includes("\0")) {
    throw new CliError("external models root must be an absolute local path", { exitCode: EXIT.usage });
  }
  const resolved = path.resolve(configured);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    throw new CliError("external models root must be a specific directory", { exitCode: EXIT.usage });
  }
  return resolved;
}

export const EXTERNAL_MODELS_ROOT = resolveExternalModelsRoot();
export const DEFAULT_ALIGNMENT_MODEL_ROOT = path.join(EXTERNAL_MODELS_ROOT, "alignment", "whisperx-en");
export const DEFAULT_PARAKEET_MODEL_ROOT = path.join(EXTERNAL_MODELS_ROOT, "parakeet-tdt-0.6b-v3");

export async function loadExternalAlignmentManifest() {
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(TRACKED_ALIGNMENT_MANIFEST, "utf8"));
  } catch {
    throw new CliError("alignment model manifest is missing or invalid", { exitCode: EXIT.modelMissing });
  }
  const topLevelKeys = new Set(["schemaVersion", "model", "modelVersion", "license", "source", "files"]);
  const sourceKeys = new Set(["url"]);
  const fileKeys = new Set(["path", "bytes", "sha256"]);
  const file = manifest.files?.[0];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || Object.keys(manifest).some((key) => !topLevelKeys.has(key))
      || manifest.schemaVersion !== "podcast-visualizer-external-model-v1"
      || manifest.model !== "WAV2VEC2_ASR_BASE_960H"
      || manifest.modelVersion !== file?.sha256 || manifest.license !== "MIT"
      || !manifest.source || typeof manifest.source !== "object" || Array.isArray(manifest.source)
      || Object.keys(manifest.source).some((key) => !sourceKeys.has(key))
      || manifest.source.url !== "https://download.pytorch.org/torchaudio/models/wav2vec2_fairseq_base_ls960_asr_ls960.pth"
      || !Array.isArray(manifest.files) || manifest.files.length !== 1
      || !file || typeof file !== "object" || Array.isArray(file)
      || Object.keys(file).some((key) => !fileKeys.has(key))
      || file.path !== "hub/checkpoints/wav2vec2_fairseq_base_ls960_asr_ls960.pth"
      || !Number.isSafeInteger(file.bytes) || file.bytes < 300 * 1024 * 1024
      || file.bytes > 500 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new CliError("alignment model manifest contract is invalid", { exitCode: EXIT.modelMissing });
  }
  return manifest;
}

export async function validateBundledDiarizationModel(modelRoot = BUNDLED_MODELS_ROOT) {
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(TRACKED_MANIFEST, "utf8"));
  } catch {
    throw new CliError("diarization model manifest is missing or invalid", { exitCode: EXIT.modelMissing });
  }
  const modelDirectory = path.join(path.resolve(modelRoot), manifest.model);
  const relative = path.relative(path.resolve(modelRoot), modelDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new CliError("diarization model path is unsafe");
  for (const file of manifest.files) {
    const target = path.join(modelDirectory, file.path);
    const targetRelative = path.relative(modelDirectory, target);
    const stat = await fsp.lstat(target).catch(() => null);
    if (targetRelative.startsWith("..") || path.isAbsolute(targetRelative)
        || !stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.bytes
        || await hashFile(target) !== file.sha256) {
      throw new CliError(`bundled diarization model failed verification: ${file.path}`, {
        exitCode: EXIT.modelMissing,
        hint: "Run npm run resources:diarization from the installed source tree."
      });
    }
  }
  return { manifest, modelRoot: path.resolve(modelRoot), modelDirectory };
}

export async function validateExternalAlignmentModel(modelRoot = DEFAULT_ALIGNMENT_MODEL_ROOT) {
  const manifest = await loadExternalAlignmentManifest();
  const resolvedRoot = path.resolve(modelRoot);
  const rootStat = await fsp.lstat(resolvedRoot).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new CliError("the imported alignment model is missing", {
      exitCode: EXIT.modelMissing,
      hint: "Run npm run models:fetch:alignment from the installed source tree."
    });
  }
  for (const file of manifest.files) {
    const target = path.resolve(resolvedRoot, file.path);
    const relative = path.relative(resolvedRoot, target);
    const stat = await fsp.lstat(target).catch(() => null);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !stat || stat.isSymbolicLink()
        || !stat.isFile() || stat.size !== file.bytes || await hashFile(target) !== file.sha256) {
      throw new CliError(`alignment model failed verification: ${file.path}`, {
        exitCode: EXIT.modelMissing,
        hint: "Restore the pinned model with npm run models:fetch:alignment."
      });
    }
  }
  return { manifest, modelRoot: resolvedRoot };
}

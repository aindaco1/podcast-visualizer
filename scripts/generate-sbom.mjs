import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function component({ type = "library", name, version, license, purl, hashes, properties = [] }) {
  const result = {
    type,
    "bom-ref": purl || `${type}:${name}@${version}`,
    name,
    version
  };
  if (license) result.licenses = [{ license: { id: license } }];
  if (purl) result.purl = purl;
  if (hashes?.length) result.hashes = hashes.map((content) => ({ alg: "SHA-256", content }));
  if (properties.length) result.properties = properties;
  return result;
}

export async function buildSbom(root = ROOT, {
  packageResolvedPath = path.join(ROOT, "macos", "Package.resolved")
} = {}) {
  const [pkg, sparkleResolved, ffmpeg, node, speech, alignment, diarization, alignModel] = await Promise.all([
    readJson(path.join(root, "package.json")),
    readJson(packageResolvedPath),
    readJson(path.join(root, "runtime", "macos-arm64", "manifest.json")),
    readJson(path.join(root, "runtime", "macos-arm64", "node-manifest.json")),
    readJson(path.join(root, "runtime", "macos-arm64", "speech-manifest.json")),
    readJson(path.join(root, "runtime", "macos-arm64", "alignment-manifest.json")),
    readJson(path.join(root, "resources", "model-manifests", "speaker-diarization-coreml.json")),
    readJson(path.join(root, "resources", "model-manifests", "whisperx-en.json"))
  ]);
  const sparkle = sparkleResolved.pins.find(({ identity }) => identity === "sparkle")?.state;
  if (sparkle?.version !== "2.9.5" || !/^[a-f0-9]{40}$/.test(sparkle.revision)) {
    throw new Error("Sparkle release dependency is not pinned to the reviewed version");
  }
  const components = [
    component({ type: "application", name: pkg.name, version: pkg.version, license: "MIT" }),
    component({ type: "framework", name: "Sparkle", version: sparkle.version, license: "MIT", purl: `pkg:github/sparkle-project/Sparkle@${sparkle.revision}` }),
    component({ type: "framework", name: "Node.js", version: node.version, hashes: [node.source.sha256], purl: `pkg:generic/node@${node.version}` }),
    component({ type: "application", name: "FFmpeg", version: ffmpeg.files.find((item) => item.path === "bin/ffmpeg")?.version || "8.1.2", license: "LGPL-2.1-or-later", hashes: [ffmpeg.source.sha256], purl: "pkg:generic/ffmpeg@8.1.2" }),
    component({ type: "framework", name: "CPython", version: alignment.pythonVersion, license: "PSF-2.0", purl: `pkg:generic/cpython@${alignment.pythonVersion}` }),
    component({ type: "library", name: "FluidAudio", version: speech.fluidAudio.version, license: "Apache-2.0", purl: `pkg:github/FluidInference/FluidAudio@${speech.fluidAudio.revision}` }),
    component({ type: "library", name: "RecordSpeech", version: speech.recordRevision.slice(0, 12), license: "MIT", purl: `pkg:github/aindaco1/record@${speech.recordRevision}` }),
    component({ type: "machine-learning-model", name: diarization.model, version: diarization.source.revision, license: "CC-BY-4.0", purl: `pkg:huggingface/FluidInference/speaker-diarization-coreml@${diarization.source.revision}` }),
    component({ type: "machine-learning-model", name: alignModel.model, version: alignModel.modelVersion, license: "MIT", hashes: [alignModel.modelVersion], purl: `pkg:generic/WAV2VEC2_ASR_BASE_960H@${alignModel.modelVersion}`, properties: [{ name: "podcast-visualizer:distribution", value: "external-not-bundled" }] }),
    component({ type: "machine-learning-model", name: "parakeet-tdt-0.6b-v3", version: "aed02740059203c4a87495924f685de3722ae9ce", purl: "pkg:huggingface/FluidInference/parakeet-tdt-0.6b-v3-coreml@aed02740059203c4a87495924f685de3722ae9ce", properties: [{ name: "podcast-visualizer:distribution", value: "external-not-bundled" }] }),
    component({ type: "data", name: "NLTK punkt_tab", version: alignment.punktTab.sha256.slice(0, 12), hashes: [alignment.punktTab.sha256], properties: [{ name: "podcast-visualizer:source", value: alignment.punktTab.url }] }),
    component({ type: "data", name: "Inter", version: "c28e08582e7b", license: "OFL-1.1" }),
    component({ type: "data", name: "IBM Plex Mono", version: "c28e08582e7b", license: "OFL-1.1" })
  ];
  for (const item of alignment.packages) {
    const normalized = item.name.toLowerCase().replace(/_/g, "-");
    components.push(component({
      name: item.name,
      version: item.version,
      purl: `pkg:pypi/${encodeURIComponent(normalized)}@${encodeURIComponent(item.version)}`
    }));
  }
  const deduplicated = [...new Map(components.map((item) => [item["bom-ref"], item])).values()]
    .sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  const application = deduplicated.find((item) => item.name === pkg.name);
  const dependencyRefs = deduplicated.filter((item) => item !== application).map((item) => item["bom-ref"]);
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [component({ type: "application", name: "podcast-visualizer-sbom-generator", version: pkg.version })] },
      component: application,
      properties: [
        { name: "podcast-visualizer:alignment-runtime-tree-sha256", value: alignment.tree.sha256 },
        { name: "podcast-visualizer:runtime-manifest-sha256", value: ffmpeg.manifestSha256 },
        { name: "podcast-visualizer:source-summary-sha256", value: sha256(JSON.stringify({ node, speech, alignment })) }
      ]
    },
    components: deduplicated.filter((item) => item !== application),
    dependencies: [{ ref: application["bom-ref"], dependsOn: dependencyRefs }]
  };
}

export async function writeSbom(outputPath, root = ROOT, options = {}) {
  const sbom = await buildSbom(root, options);
  await fsp.writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  return sbom;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] || path.join(ROOT, "dist", "podcast-visualizer.sbom.cdx.json"));
  const inputRoot = path.resolve(process.argv[3] || ROOT);
  await fsp.mkdir(path.dirname(output), { recursive: true, mode: 0o755 });
  await writeSbom(output, inputRoot);
  process.stdout.write(`${output}\n`);
}

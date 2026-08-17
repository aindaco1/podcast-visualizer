import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import test from "node:test";

import { buildSbom } from "../scripts/generate-sbom.mjs";

const runtimeManifest = await fsp.lstat(new URL("../runtime/macos-arm64/alignment-manifest.json", import.meta.url))
  .catch(() => null);

test("builds a CycloneDX inventory with bundled and external model provenance", {
  skip: !runtimeManifest?.isFile()
}, async () => {
  const sbom = await buildSbom();
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal(sbom.specVersion, "1.6");
  assert.equal(sbom.metadata.component.version, "1.1.2");
  assert.ok(sbom.components.some(({ name, version }) => name === "Sparkle" && version === "2.9.5"));
  assert.ok(sbom.components.some(({ name, version }) => name.toLowerCase() === "whisperx" && version === "3.8.6"));
  assert.ok(sbom.components.some(({ name }) => name === "WAV2VEC2_ASR_BASE_960H"));
  assert.ok(sbom.components.some(({ name, licenses }) =>
    name === "parakeet-tdt-0.6b-v3" && licenses?.[0]?.license?.id === "CC-BY-4.0"));
  assert.equal(new Set(sbom.components.map((item) => item["bom-ref"])).size, sbom.components.length);
});

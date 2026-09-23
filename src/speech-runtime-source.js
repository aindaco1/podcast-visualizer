// Exact schema-to-owner mapping preserves validation of earlier bundled runtimes.
export function speechRuntimeSource(manifest) {
  const schemas = {
    "podcast-visualizer-speech-runtime-v1": ["recordRevision", false],
    "podcast-visualizer-speech-runtime-v2": ["recordRevision", true],
    "podcast-visualizer-speech-runtime-v3": ["platformRevision", false],
    "podcast-visualizer-speech-runtime-v4": ["platformRevision", true]
  };
  const schema = schemas[manifest?.schemaVersion];
  if (!schema || !/^[a-f0-9]{40}$/.test(manifest[schema[0]] || "")) {
    throw new Error("bundled speech runtime source is invalid");
  }
  const [field, signed] = schema;
  const platform = field === "platformRevision";
  return { field, signed, revision: manifest[field],
    name: platform ? "DustWaveSpeech" : "RecordSpeech",
    repository: platform ? "dust-wave-platform" : "record" };
}

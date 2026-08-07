import { parseOptions, requireOptions } from "./args.js";
import { CliError, EXIT } from "./errors.js";
import { initializeProject, loadProject } from "./project.js";

const HELP = `Podcast Visualizer

Usage:
  dustwave-video init --source FILE --project DIRECTORY --clip START-END [--json]
  dustwave-video status --project DIRECTORY [--json]
  dustwave-video doctor [--json]
  dustwave-video --help

Commands:
  init      Create a new immutable project from local media.
  status    Validate and show the current project state.
  doctor    Check the current development runtime.

Exit codes:
  0 success; 2 usage; 3 review required; 4 model missing;
  5 quality gate; 6 render failure.
`;

function output(value, json) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

async function initCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["source", "value"], ["project", "value"], ["clip", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["source", "project", "clip"]);
  const result = await initializeProject(options);
  output(options.json ? {
    projectRoot: result.projectRoot,
    projectId: result.manifest.projectId,
    state: result.manifest.state,
    manifestSha256: result.manifest.manifestSha256
  } : `Initialized ${result.manifest.projectId} at ${result.projectRoot}`, options.json);
}

async function statusCommand(argv) {
  const options = parseOptions(argv, new Map([
    ["project", "value"], ["json", "boolean"]
  ]));
  requireOptions(options, ["project"]);
  const result = await loadProject(options.project);
  output(options.json ? {
    projectRoot: result.projectRoot,
    projectId: result.manifest.projectId,
    state: result.manifest.state,
    sourceSha256: result.manifest.source.sha256,
    clip: result.manifest.clip
  } : `${result.manifest.projectId}: ${result.manifest.state}`, options.json);
}

async function doctorCommand(argv) {
  const options = parseOptions(argv, new Map([["json", "boolean"]]));
  const major = Number(process.versions.node.split(".")[0]);
  const checks = [
    { id: "node", ok: major >= 22, detail: process.version },
    { id: "platform", ok: process.platform === "darwin", detail: process.platform },
    { id: "architecture", ok: process.arch === "arm64", detail: process.arch }
  ];
  const result = { ok: checks.every((check) => check.ok), checks };
  output(options.json ? result : checks.map((check) => `${check.ok ? "ok" : "fail"} ${check.id}: ${check.detail}`).join("\n"), options.json);
  if (!result.ok) throw new CliError("development runtime is not release-compatible");
}

export async function runCli(argv) {
  try {
    const [command, ...rest] = argv;
    if (!command || command === "--help" || command === "-h" || command === "help") {
      process.stdout.write(HELP);
      return EXIT.ok;
    }
    if (command === "init") await initCommand(rest);
    else if (command === "status") await statusCommand(rest);
    else if (command === "doctor") await doctorCommand(rest);
    else throw new CliError(`unknown command: ${command}`, { exitCode: EXIT.usage, hint: "Run dustwave-video --help." });
    return EXIT.ok;
  } catch (error) {
    const known = error instanceof CliError;
    process.stderr.write(`dustwave-video: ${known ? error.message : "unexpected failure"}\n`);
    if (known && error.hint) process.stderr.write(`hint: ${error.hint}\n`);
    if (!known && process.env.PODCAST_VISUALIZER_DEBUG === "1") process.stderr.write(`${error.stack}\n`);
    return known ? error.exitCode : EXIT.failure;
  }
}


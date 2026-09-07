import assert from "node:assert/strict";
import test from "node:test";

import { runProcess } from "../src/process.js";
import { __test as render } from "../src/render.js";
import { errorResult } from "../src/cli.js";
import { failureDetails } from "../src/errors.js";

test("render error JSON retains bounded process evidence without raw streams or paths", async () => {
  const cases = [
    { args: ["-e", "process.stderr.write('/Users/private/Secret.wav: No space left on device'); process.exit(1)"], expected: { cause: "process_exit", reason: "disk_full", processExitCode: 1 } },
    { args: ["-e", "process.stderr.write('/Users/private/Secret-podcast.wav'); process.exit(17)"], expected: { cause: "process_exit", processExitCode: 17 } },
    { args: ["-e", "process.kill(process.pid, 'SIGTERM')"], expected: { cause: "process_signal", processSignal: "SIGTERM" } },
    { args: ["-e", "setInterval(()=>{}, 100)"], options: { timeoutMs: 100 }, expected: { cause: "process_timeout", processSignal: "SIGKILL" } },
    { args: ["-e", "process.stdout.write('Secret-'.repeat(100))"], options: { maximumOutputBytes: 8 }, expected: { cause: "process_output_limit" } },
    { command: "/missing/Secret-helper", args: [], expected: { cause: "process_spawn", systemCode: "ENOENT" } }
  ];
  for (const scenario of cases) {
    await assert.rejects(render.renderStep("encoding", () => runProcess(scenario.command ?? process.execPath,
      scenario.args, scenario.options)), error => {
      const result = errorResult(error, "render", true);
      assert.equal(result.exitCode, 6);
      assert.equal(result.error.diagnosticCode, "render_encoding_failed");
      assert.deepEqual(result.error.failureDetails, scenario.expected);
      assert.doesNotMatch(JSON.stringify(result), /Secret-|\/Users\/|\/missing\//);
      assert.match(result.error.hint, /preserved/);
      return true;
    });
  }
  assert.deepEqual(failureDetails(Object.assign(new TypeError("Secret-text"), { code: "ENOSPC" })),
    { cause: "type_error", systemCode: "ENOSPC" });
  assert.deepEqual(failureDetails({ failureDetails: { cause: "Secret-text", processExitCode: 256,
    processSignal: "Secret-signal", systemCode: "Secret-code", stack: "Secret-stack" } }), { cause: "unknown" });
});

test("streams subprocess output without requiring it to be retained", async () => {
  const chunks = [];
  const result = await runProcess(process.execPath, ["-e", "process.stdout.write('one\\ntwo\\n')"], {
    onStdout: (chunk) => chunks.push(chunk.toString("utf8")),
    captureStdout: false
  });
  assert.equal(chunks.join(""), "one\ntwo\n");
  assert.equal(result.stdout, "");
});

test("kills a subprocess when a streaming consumer rejects its output", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.stdout.write('bad')"], {
      onStdout: () => { throw new Error("invalid stream"); }
    }),
    /invalid stream/
  );
});

test("keeps an inherited auxiliary protocol separate from standard output", async () => {
  const protocol = [];
  const result = await runProcess(process.execPath, ["-e", [
    "const fs = require('node:fs');",
    "process.stdout.write('third-party diagnostic\\n');",
    "fs.writeSync(3, 'protocol-only\\n');"
  ].join("")], {
    onAuxiliary: (chunk) => protocol.push(chunk.toString("utf8"))
  });

  assert.equal(result.stdout, "third-party diagnostic\n");
  assert.equal(result.auxiliary, "");
  assert.equal(protocol.join(""), "protocol-only\n");
});

test("bounds streamed output even when it is not retained", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024))"], {
      maximumOutputBytes: 32,
      captureStdout: false
    }),
    /emitted too much output/
  );
});

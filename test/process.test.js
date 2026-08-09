import assert from "node:assert/strict";
import test from "node:test";

import { runProcess } from "../src/process.js";

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

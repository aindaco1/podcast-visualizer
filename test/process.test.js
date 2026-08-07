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

#!/usr/bin/env node
import { optimizeReleaseRuntime } from "./runtime-optimization.mjs";

if (process.argv.length !== 4) {
  process.stderr.write("usage: optimize-runtime.mjs <source-runtime> <new-runtime>\n");
  process.exitCode = 64;
} else {
  const result = await optimizeReleaseRuntime(process.argv[2], process.argv[3]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

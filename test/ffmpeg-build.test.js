import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pins an LGPL, offline FFmpeg build with libass and Apple encoders", () => {
  const result = spawnSync("/bin/bash", [path.join(ROOT, "scripts/build-ffmpeg.sh"), "--print-config"], {
    encoding: "utf8", shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  const config = Object.fromEntries(result.stdout.trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  assert.equal(config.version, "8.1.2");
  assert.match(config.sha256, /^[a-f0-9]{64}$/);
  assert.equal(config.license, "LGPL-2.1-or-later");
  assert.match(config.flags, /--disable-network/);
  assert.match(config.flags, /--enable-libass/);
  assert.match(config.flags, /--enable-videotoolbox/);
  assert.match(config.flags, /--enable-zlib/);
  assert.match(config.flags, /--enable-decoder=png/);
  assert.match(config.flags, /--enable-filter=overlay/);
  assert.match(config.flags, /--pkg-config-flags=--static/);
  assert.doesNotMatch(config.flags, /--enable-gpl|--enable-nonfree/);
});

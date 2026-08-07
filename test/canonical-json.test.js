import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, canonicalize, sha256 } from "../src/canonical-json.js";

test("canonical JSON sorts recursively and normalizes negative zero", () => {
  assert.equal(canonicalJson({ z: -0, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":0}\n');
});

test("canonical JSON rejects lossy values and class instances", () => {
  assert.throws(() => canonicalize({ bad: undefined }), /undefined/);
  assert.throws(() => canonicalize({ bad: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalize(new Date()), /plain objects/);
});

test("hashes are order independent for objects", () => {
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
  assert.match(sha256("example"), /^[a-f0-9]{64}$/);
});


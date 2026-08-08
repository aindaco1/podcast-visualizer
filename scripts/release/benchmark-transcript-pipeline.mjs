#!/usr/bin/env node
import { performance } from "node:perf_hooks";

import { normalizeEnglishEditorialWords } from
  "../../shared/dust-wave-platform/packages/timed-text/src/editorial.js";
import {
  DEFAULT_TIMED_WORD_GROUPING_POLICY, groupTimedWords
} from "../../shared/dust-wave-platform/packages/timed-text/src/word-grouping.js";

function evidence(values) {
  const ordered = values.slice().sort((left, right) => left - right);
  return {
    medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(3)),
    worstMs: Number(Math.max(...values).toFixed(3))
  };
}

const results = [];
for (const minutes of [5, 30, 120]) {
  const wordCount = minutes * 150;
  const text = Array.from({ length: wordCount }, (_, index) =>
    index % 19 === 18 ? "episode." : index % 17 === 0 ? "i" : "discussion");
  const timed = text.map((word, index) => ({
    text: word,
    startsAtMs: index * 390,
    endsAtMs: index * 390 + 320
  }));
  const durationMs = timed.at(-1).endsAtMs;
  const normalizationMs = [];
  const groupingMs = [];
  for (let run = 0; run < 9; run += 1) {
    let started = performance.now();
    normalizeEnglishEditorialWords(text);
    normalizationMs.push(performance.now() - started);
    started = performance.now();
    groupTimedWords(timed, {
      durationMs,
      policy: DEFAULT_TIMED_WORD_GROUPING_POLICY
    });
    groupingMs.push(performance.now() - started);
  }
  results.push({
    minutes,
    words: wordCount,
    normalization: evidence(normalizationMs),
    grouping: evidence(groupingMs)
  });
}

process.stdout.write(`${JSON.stringify({
  node: process.version,
  architecture: process.arch,
  runs: 9,
  results
}, null, 2)}\n`);

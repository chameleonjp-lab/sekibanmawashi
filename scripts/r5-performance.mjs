import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { evaluate } from "../src/core/engine.ts";

const distRoot = "dist";
const puzzlePath = "content/puzzles-v2.json";

async function filesIn(directory) {
  const entries = await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return nested.flat();
}

const distFiles = await filesIn(distRoot);
const distSizes = await Promise.all(distFiles.map(async (path) => ({
  path,
  bytes: (await stat(path)).size,
  content: await readFile(path),
})));
const javascript = distSizes.filter((entry) => /\.js$/u.test(entry.path));
const puzzleContent = await readFile(puzzlePath);
const puzzles = JSON.parse(puzzleContent.toString());
const partCounts = puzzles.map((puzzle) => puzzle.rings.reduce((sum, ring) => sum + ring.parts.length, 0));

// The benchmark covers every encoded state of the published pool. It keeps
// the target as an observed number rather than claiming a synthetic bound.
const samples = [];
for (const puzzle of puzzles) {
  for (let encoded = 0; encoded < 1_728; encoded += 1) {
    const rotations = [encoded % 12, Math.floor(encoded / 12) % 12, Math.floor(encoded / 144) % 12];
    const started = performance.now();
    evaluate(puzzle, { rotations });
    samples.push(performance.now() - started);
  }
}
samples.sort((left, right) => left - right);
const percentile = (fraction) => samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))] ?? 0;
const report = {
  generatedAt: new Date().toISOString(),
  distBytes: distSizes.reduce((sum, entry) => sum + entry.bytes, 0),
  distGzipJavascriptBytes: javascript.reduce((sum, entry) => sum + gzipSync(entry.content).byteLength, 0),
  distJavascriptBytes: javascript.reduce((sum, entry) => sum + entry.bytes, 0),
  puzzleJsonBytes: puzzleContent.byteLength,
  // The catalog is bundled into the entry JavaScript by Vite. This is a
  // standalone compression diagnostic, not a separate network response.
  puzzleJsonGzipBytes: gzipSync(puzzleContent).byteLength,
  puzzleJsonTransport: "embedded-in-javascript; standalone gzip diagnostic",
  puzzleCount: puzzles.length,
  maxParts: Math.max(...partCounts),
  evaluateSamples: samples.length,
  evaluateMilliseconds: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: samples.at(-1) ?? 0,
  },
};
console.log(JSON.stringify({ ...report, distRoot, puzzlePath, files: distFiles.map((path) => relative(distRoot, path)) }, null, 2));

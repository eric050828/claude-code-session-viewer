#!/usr/bin/env node
/**
 * Post-build scrubber.
 *
 * Next.js bakes the build machine's absolute project path into a handful of
 * artifacts under .next/standalone/ (config blobs, webpack module IDs in
 * server chunks, etc.). Those paths are only used for debug/source-map
 * purposes at runtime, so we replace them with a fixed placeholder before
 * publishing so the npm tarball doesn't carry the builder's environment.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const PLACEHOLDER = "/__BUILD_ROOT__";

const NEEDLE = ROOT; // e.g. /home/<user>/claude-code-session-viewer

if (!fs.existsSync(STANDALONE)) {
  console.error("scrub-build: .next/standalone not found — run `next build` first.");
  process.exit(1);
}

let filesScanned = 0;
let filesPatched = 0;
let replacements = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      patch(full);
    }
  }
}

function patch(file) {
  // Only text-based files; node_modules sometimes has binaries we shouldn't touch.
  const ext = path.extname(file).toLowerCase();
  if (
    ![
      ".js",
      ".mjs",
      ".cjs",
      ".json",
      ".map",
      ".html",
      ".css",
      ".txt",
    ].includes(ext)
  ) {
    return;
  }
  filesScanned++;
  let buf;
  try {
    buf = fs.readFileSync(file, "utf-8");
  } catch {
    return;
  }
  if (!buf.includes(NEEDLE)) return;
  const before = buf;
  const out = buf.split(NEEDLE).join(PLACEHOLDER);
  if (out === before) return;
  fs.writeFileSync(file, out);
  filesPatched++;
  // count occurrences for reporting
  let count = 0;
  let idx = 0;
  while ((idx = before.indexOf(NEEDLE, idx)) !== -1) {
    count++;
    idx += NEEDLE.length;
  }
  replacements += count;
}

walk(STANDALONE);

console.log(
  `scrub-build: scanned ${filesScanned} files, patched ${filesPatched}, replaced ${replacements} occurrences of\n  "${NEEDLE}"\n  → "${PLACEHOLDER}"`,
);

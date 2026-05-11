#!/usr/bin/env node
/**
 * Pre-publish guard. Walks every file that will end up in the npm tarball and
 * fails the publish if it finds anything that looks like the publisher's
 * environment leaking through (home dir name, internal project names, etc.).
 *
 * Run via `npm run prepublishOnly` — npm executes this before `npm publish`.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");

// Compute the current user's home segment dynamically so this guard doesn't
// itself contain the very string it's looking for.
const homeSegment = os
  .homedir()
  .replace(/\\/g, "/")
  .split("/")
  .filter(Boolean)
  .pop(); // e.g. "alice" from /home/alice

// Patterns that should always fail — these get scanned in every shipped file.
const FORBIDDEN_EVERYWHERE = [
  // The builder's absolute project path (anything under /home/<user>/...).
  new RegExp(`/home/${homeSegment}(?:/|\\b)`, "g"),
  new RegExp(`/Users/${homeSegment}(?:/|\\b)`, "g"),
  // Company / org tokens — add new ones here as the project picks up more.
  /\bgenibuilder\b/gi,
];

// Patterns scanned only in our own source / docs / scripts. Skipped inside
// node_modules and other vendored trees, where third-party package metadata
// legitimately contains the public emails of open-source maintainers.
const FORBIDDEN_IN_OWN_FILES = [
  // Anything that looks like a personal email but isn't a public free-mail
  // provider or the GitHub privacy-email format.
  /[\w.+-]+@(?!(?:gmail|googlemail|outlook|hotmail|yahoo|proton|protonmail|icloud|example|users\.noreply\.github|anthropic)\.com)[\w.-]+\.(?:com|net|org|io|co|dev|app|ai|tw|jp|cn)\b/gi,
];

function isVendoredPath(rel) {
  return (
    rel.startsWith(".next/") || // Next.js build output incl. its node_modules
    rel.includes("/node_modules/")
  );
}

const pkgJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
);
const includeRoots = (pkgJson.files || []).map((p) => path.join(ROOT, p));

const TEXT_EXTS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".html",
  ".css",
  ".txt",
  ".map",
]);

const hits = [];

function walk(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
  } else if (stat.isFile()) {
    scan(target);
  }
}

function scan(file) {
  if (!TEXT_EXTS.has(path.extname(file).toLowerCase())) return;
  let buf;
  try {
    buf = fs.readFileSync(file, "utf-8");
  } catch {
    return;
  }
  const rel = path.relative(ROOT, file);
  const patterns = isVendoredPath(rel)
    ? FORBIDDEN_EVERYWHERE
    : [...FORBIDDEN_EVERYWHERE, ...FORBIDDEN_IN_OWN_FILES];
  for (const re of patterns) {
    re.lastIndex = 0;
    const matches = buf.match(re);
    if (matches) {
      hits.push({
        file: rel,
        pattern: String(re),
        count: matches.length,
        sample: matches[0],
      });
    }
  }
}

for (const root of includeRoots) walk(root);

if (hits.length === 0) {
  console.log(
    `check-no-leaks: OK — no forbidden patterns in published files (scanned ${includeRoots.length} root paths).`,
  );
  process.exit(0);
}

console.error("check-no-leaks: FAILED — leak candidates found:");
for (const h of hits.slice(0, 50)) {
  console.error(
    `  ${h.file}  (${h.count}×) pattern=${h.pattern}  e.g. "${h.sample}"`,
  );
}
if (hits.length > 50) console.error(`  …and ${hits.length - 50} more`);
console.error(
  "\nRun `npm run build` (which invokes scripts/scrub-build.js) and re-run.",
);
process.exit(1);

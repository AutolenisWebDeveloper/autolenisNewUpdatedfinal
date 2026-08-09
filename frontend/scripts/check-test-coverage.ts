/**
 * Test-reachability guard.
 *
 * Fails if a `*.test.ts(x)` file exists in the repo but is not reachable from any
 * `test*` script in package.json — i.e. a test that can never run, in CI or locally.
 *
 * This is an executable control, not a convention: the 2026-08 skill-system audit
 * found three such orphaned suites (20 passing assertions that nothing invoked).
 * Written tests only protect you if something actually runs them.
 *
 *   pnpm test:coverage-check
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// pnpm always runs package scripts from the package root, which is what every
// path in package.json is relative to. Assert it rather than assume it.
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "package.json"))) {
  console.error(`Run this from the frontend package root (cwd was ${ROOT}).`);
  process.exit(1);
}

// Directories that never hold app tests.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
]);

/** Every test file in the tree, as repo-relative POSIX paths. */
function findTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      findTestFiles(full, acc);
    } else if (/\.test\.tsx?$/.test(entry)) {
      acc.push(relative(ROOT, full).split("\\").join("/"));
    }
  }
  return acc;
}

/**
 * Expand the path arguments of a `tsx --test ...` script into concrete files.
 * Only the two shapes the repo actually uses are supported — an explicit file
 * path, and a single trailing `*` glob (`some/dir/__tests__/*.test.ts`). An
 * unrecognised shape is reported rather than silently treated as covering
 * nothing, so this guard can never quietly under-report.
 */
function expandScriptTargets(script: string, unsupported: string[]): string[] {
  const files: string[] = [];
  for (const rawToken of script.split(/\s+/)) {
    if (!/\.tsx?$/.test(rawToken) || rawToken.startsWith("-")) continue;
    const token = rawToken.replace(/^["']|["']$/g, "");
    if (!token.includes("*")) {
      files.push(token);
      continue;
    }
    const slash = token.lastIndexOf("/");
    const dir = token.slice(0, slash);
    const pattern = token.slice(slash + 1);
    if (dir.includes("*")) {
      unsupported.push(token); // directory-level glob — not used today
      continue;
    }
    const rx = new RegExp("^" + pattern.split("*").map(escapeRx).join(".*") + "$");
    let entries: string[];
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch {
      unsupported.push(`${token} (directory missing)`);
      continue;
    }
    for (const e of entries) if (rx.test(e)) files.push(`${dir}/${e}`);
  }
  return files;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const unsupported: string[] = [];
const covered = new Set<string>();
for (const [name, script] of Object.entries(pkg.scripts)) {
  if (!name.startsWith("test")) continue;
  for (const f of expandScriptTargets(script, unsupported)) covered.add(f);
}

const all = findTestFiles(ROOT).sort();
const orphans = all.filter((f) => !covered.has(f));

console.log(`test files found:      ${all.length}`);
console.log(`reachable via scripts: ${all.length - orphans.length}`);

if (unsupported.length > 0) {
  console.log("\nUnparsed script targets (extend this guard if these are real):");
  for (const u of unsupported) console.log(`  ? ${u}`);
}

if (orphans.length > 0) {
  console.error("\nORPHANED TEST FILES — no package.json script runs these:");
  for (const o of orphans) console.error(`  ✗ ${o}`);
  console.error(
    "\nAdd each to an existing test:* script (or a new one) and include it in test:all.",
  );
  process.exit(1);
}

console.log("\nOK — every test file is reachable from a test:* script.");

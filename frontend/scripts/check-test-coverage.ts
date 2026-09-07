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

// ── §12.2 correction 2 — reachability is not membership ──────────────────────────────────────────
// The check above proves every test FILE is reachable from SOME `test*` script. It says nothing
// about whether that script is one CI actually runs. `pnpm test:all` is the gate; a `test:foo`
// script that is never chained into it satisfies the guard above and still never runs in CI, so a
// whole suite can be added, pass the guard, and be dead on arrival.
//
// The exempt list is required, not a loophole. Six scripts are legitimately outside the chain: they
// need a real database, a running app, or a browser, and CI runs them in their own jobs. Without the
// list this correction would fail the build on the day it landed. Each entry carries its reason, and
// adding one is a reviewable diff — which is the property being protected.
const CHAIN_EXEMPT: Record<string, string> = {
  "test:coverage-check": "this guard itself; it is not a suite",
  "test:integration": "needs a real database",
  "test:e2e": "needs a running app; CI runs it in the E2E job",
  "test:e2e-autopilot": "needs a running app; CI runs it in the E2E job",
  "test:visual": "needs a browser; CI runs it in its own job",
  "test:visual:update": "regenerates snapshots; never a gate",
  "test:concurrency":
    "deliberately outside the chain (§12.2 correction 3 / §13-D51): it writes real rows and " +
    "resolves a destructive target, so it runs only in the E2E job against that job's ephemeral " +
    "autolenis_e2e database (ci.yml:445)",
  "test:matrix":
    "not a suite — it is the runner that derives the suite list FROM test:all and runs each one " +
    "separately so a later failure cannot be masked (ci.yml:106)",
};

const chain = pkg.scripts["test:all"] ?? "";
const chained = new Set(
  [...chain.matchAll(/pnpm\s+(test(?::[\w:-]+)?)/g)].map((m) => m[1]),
);

const unchained = Object.keys(pkg.scripts)
  .filter((n) => /^test(:|$)/.test(n))
  .filter((n) => n !== "test:all")
  .filter((n) => !chained.has(n))
  .filter((n) => !(n in CHAIN_EXEMPT));

console.log(`test:* scripts chained into test:all: ${chained.size}`);

if (unchained.length > 0) {
  console.error("\nTEST SCRIPTS THAT NEVER RUN IN CI — not in the test:all chain and not exempt:");
  for (const u of unchained) console.error(`  ✗ ${u}`);
  console.error(
    "\nChain each into test:all, or add it to CHAIN_EXEMPT with the reason it runs elsewhere.",
  );
  process.exit(1);
}

console.log("\nOK — every test file is reachable from a test:* script.");
console.log("OK — every test:* script is in the test:all chain or exempt with a reason.");

/**
 * The CI test matrix runner.
 *
 * Runs every suite in `test:all` INDEPENDENTLY and reports the COMPLETE failure
 * set, instead of stopping at the first red suite.
 *
 * WHY THIS EXISTS
 * `test:all` is a single `&&` chain of `pnpm test:*` invocations, so the moment
 * one suite fails the shell stops and every suite after it never executes. CI
 * therefore reported the first failing suite and nothing else — main was red on
 * five suites and only the first was ever visible, and moving the stopping point
 * later in the chain uncovered fourteen suites that had never executed in CI at
 * all. A chain cannot tell you what it did not run, and it cannot tell you it
 * did not run it.
 *
 * WHAT THIS CHANGES, AND WHAT IT DOES NOT
 * Nothing about what any suite asserts. Nothing is skipped or quarantined: every
 * suite in the chain is executed, with its output streamed, and the process still
 * exits non-zero if any of them failed. `test:all` itself is deliberately left
 * fail-fast — a developer running the matrix locally wants to stop at the first
 * failure. This is what CI runs in its place.
 *
 * THE LIST IS DERIVED, NEVER DUPLICATED
 * The suites come from parsing `test:all` itself, so a suite added to the chain
 * is picked up here automatically and the two can never drift. A segment this
 * parser does not recognise is a hard error rather than a silently dropped
 * suite — the failure mode this file exists to remove must not be reintroduced
 * by the file that removes it.
 *
 *   pnpm test:matrix
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SuiteResult {
  readonly suite: string;
  readonly status: "PASS" | "FAIL";
  readonly code: number;
  readonly ms: number;
}

/** Only `pnpm <script>` / `pnpm run <script>` segments are understood. */
const SEGMENT = /^pnpm\s+(?:run\s+)?(test[\w:-]*)$/;

/**
 * The ordered suite list encoded in an `&&` chain.
 *
 * Throws on anything it does not recognise. Returning a partial list would
 * reproduce the exact defect this runner removes — suites that quietly never
 * execute — so an unparseable chain fails the build loudly instead.
 */
export function parseTestAll(script: string): string[] {
  const suites: string[] = [];
  for (const raw of script.split("&&")) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    const match = SEGMENT.exec(segment);
    if (!match) {
      throw new Error(
        `Unrecognised segment in test:all: ${JSON.stringify(segment)}\n` +
          `Every segment must be "pnpm <test-script>". Extend scripts/run-test-matrix.ts ` +
          `if the chain genuinely needs another shape — do not leave a suite unrun.`,
      );
    }
    suites.push(match[1]);
  }
  if (suites.length === 0) throw new Error("test:all parsed to zero suites");
  const duplicates = suites.filter((s, i) => suites.indexOf(s) !== i);
  if (duplicates.length > 0) {
    throw new Error(`test:all runs the same suite twice: ${[...new Set(duplicates)].join(", ")}`);
  }
  return suites;
}

/** Read `test:all` out of a package.json. */
export function readTestAll(packageJsonPath: string): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = pkg.scripts?.["test:all"];
  if (!script) throw new Error(`No "test:all" script in ${packageJsonPath}`);
  return script;
}

/**
 * Run every suite, in order, regardless of what fails.
 *
 * The runner is injected so the no-early-exit guarantee is testable without
 * spawning the real matrix.
 */
export function runMatrix(
  suites: readonly string[],
  run: (suite: string) => { code: number; ms: number },
): SuiteResult[] {
  const results: SuiteResult[] = [];
  for (const suite of suites) {
    const { code, ms } = run(suite);
    results.push({ suite, status: code === 0 ? "PASS" : "FAIL", code, ms });
  }
  return results;
}

export const failed = (results: readonly SuiteResult[]): SuiteResult[] =>
  results.filter((r) => r.status === "FAIL");

/** Non-zero whenever any suite failed — the chain's one good property, kept. */
export const exitCodeFor = (results: readonly SuiteResult[]): number =>
  failed(results).length === 0 ? 0 : 1;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The console report: every suite, then the failures gathered in one place. */
export function renderSummary(results: readonly SuiteResult[]): string {
  const bad = failed(results);
  const width = Math.max(...results.map((r) => r.suite.length), 10);
  const lines = [
    "",
    "=".repeat(72),
    `TEST MATRIX — ${results.length} suites, ${results.length - bad.length} passed, ${bad.length} failed`,
    "=".repeat(72),
    ...results.map(
      (r, i) =>
        `  ${r.status === "PASS" ? "PASS" : "FAIL"}  ${String(i + 1).padStart(2)}  ` +
        `${r.suite.padEnd(width)}  ${seconds(r.ms).padStart(7)}` +
        (r.status === "FAIL" ? `  (exit ${r.code})` : ""),
    ),
    "",
  ];
  if (bad.length === 0) {
    lines.push(`All ${results.length} suites passed.`, "");
  } else {
    lines.push(
      `${bad.length} FAILING ${bad.length === 1 ? "SUITE" : "SUITES"} — the complete set, not just the first:`,
      ...bad.map((r) => `  - ${r.suite}   (reproduce with: pnpm ${r.suite})`),
      "",
    );
  }
  return lines.join("\n");
}

/** The same result set as a GitHub step summary, so the run page shows it too. */
export function renderStepSummary(results: readonly SuiteResult[]): string {
  const bad = failed(results);
  const row = (r: SuiteResult) =>
    `| \`${r.suite}\` | ${r.status === "PASS" ? "pass" : "**FAIL**"} | ${seconds(r.ms)} |`;
  const out = [
    "### Test matrix",
    "",
    `${results.length} suites · ${results.length - bad.length} passed · ${bad.length} failed`,
    "",
  ];
  if (bad.length > 0) {
    out.push(
      "**Failing suites (complete set):**",
      "",
      "| suite | result | time |",
      "| --- | --- | --- |",
      ...bad.map(row),
      "",
    );
  }
  out.push(
    "<details><summary>All suites</summary>",
    "",
    "| suite | result | time |",
    "| --- | --- | --- |",
    ...results.map(row),
    "",
    "</details>",
    "",
  );
  return out.join("\n");
}

function main(): void {
  const root = process.cwd();
  const suites = parseTestAll(readTestAll(join(root, "package.json")));
  const inActions = process.env.GITHUB_ACTIONS === "true";

  console.log(`Running ${suites.length} test suites independently — no suite is skipped on failure.\n`);

  const results = runMatrix(suites, (suite) => {
    const index = suites.indexOf(suite) + 1;
    const header = `[${index}/${suites.length}] pnpm ${suite}`;
    console.log(inActions ? `::group::${header}` : `\n──── ${header}`);
    const started = Date.now();
    // shell on Windows only, where `pnpm` is a .cmd shim. Suite names come from
    // the SEGMENT regex above ([\w:-] only), so nothing shell-special can reach it.
    const child = spawnSync("pnpm", ["run", suite], {
      stdio: "inherit",
      cwd: root,
      shell: process.platform === "win32",
    });
    const ms = Date.now() - started;
    if (inActions) console.log("::endgroup::");
    // A spawn that never started is a failure, not a pass by omission.
    const code = child.error ? 1 : (child.status ?? 1);
    if (child.error) console.error(`could not start "pnpm ${suite}": ${child.error.message}`);
    console.log(`${code === 0 ? "PASS" : "FAIL"} ${suite} (${seconds(ms)})`);
    return { code, ms };
  });

  console.log(renderSummary(results));

  if (inActions) {
    for (const r of failed(results)) {
      console.log(`::error::${r.suite} failed (exit ${r.code}) — reproduce with: pnpm ${r.suite}`);
    }
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) appendFileSync(summaryPath, renderStepSummary(results));
  }

  // exitCode, not exit(): spawnSync is synchronous and nothing else holds the
  // loop open, so the process ends on its own with every byte of the report
  // already flushed. process.exit() can truncate a buffered stream.
  process.exitCode = exitCodeFor(results);
}

// Only when invoked as a command; the unit test imports the pieces above.
if (typeof require !== "undefined" && require.main === module) main();

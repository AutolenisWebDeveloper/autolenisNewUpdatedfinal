// Guard for the CI test matrix runner.
//
// The defect this runner removes is invisible by construction: an `&&` chain
// that stops early does not report the suites it never reached, so nothing about
// the CI output distinguishes "the rest passed" from "the rest never ran". The
// only protection against that returning is an executable one, so the runner's
// two load-bearing properties are asserted here — it runs EVERY suite even after
// one fails, and it still exits non-zero — along with the contract that CI
// actually invokes it rather than the fail-fast chain.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseTestAll,
  readTestAll,
  runMatrix,
  renderSummary,
  renderStepSummary,
  failed,
  exitCodeFor,
  type SuiteResult,
} from "../run-test-matrix";

const ROOT = process.cwd();
const PACKAGE_JSON = join(ROOT, "package.json");
const CI_YML = join(ROOT, "..", ".github", "workflows", "ci.yml");

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { scripts: Record<string, string> };

describe("the suite list is derived from test:all, never duplicated", () => {
  test("every suite parsed out of the chain is a real package script", () => {
    const suites = parseTestAll(readTestAll(PACKAGE_JSON));
    assert.ok(suites.length > 50, `only ${suites.length} suites parsed — the parser is broken`);
    const missing = suites.filter((s) => !(s in pkg.scripts));
    assert.deepEqual(missing, [], `test:all names scripts that do not exist:\n${missing.join("\n")}`);
  });

  test("the parsed list is exactly the chain, in order", () => {
    // Independent re-derivation: if the parser ever drops a segment, the counts
    // diverge here rather than a suite quietly disappearing from CI.
    const raw = pkg.scripts["test:all"].split("&&").map((s) => s.trim()).filter(Boolean);
    const suites = parseTestAll(pkg.scripts["test:all"]);
    assert.equal(suites.length, raw.length, "a segment of test:all was dropped");
    assert.deepEqual(suites, raw.map((s) => s.replace(/^pnpm\s+(run\s+)?/, "")));
  });

  test("`pnpm run <suite>` spelling is accepted too", () => {
    assert.deepEqual(parseTestAll("pnpm run test:a && pnpm test:b"), ["test:a", "test:b"]);
  });

  test("an unrecognised segment is a hard error, never a silently dropped suite", () => {
    assert.throws(() => parseTestAll("pnpm test:a && echo skipped"), /Unrecognised segment/);
    assert.throws(() => parseTestAll("pnpm test:a && pnpm build"), /Unrecognised segment/);
    assert.throws(() => parseTestAll(""), /zero suites/);
  });

  test("a suite listed twice is an error — it would double a failure count", () => {
    assert.throws(() => parseTestAll("pnpm test:a && pnpm test:b && pnpm test:a"), /twice/);
  });
});

describe("a failing suite does not stop the ones after it", () => {
  const SUITES = ["test:one", "test:two", "test:three", "test:four"];

  test("every suite runs even when the first fails", () => {
    const ran: string[] = [];
    const results = runMatrix(SUITES, (suite) => {
      ran.push(suite);
      return { code: suite === "test:one" ? 1 : 0, ms: 1 };
    });
    assert.deepEqual(ran, SUITES, "execution stopped early — this is the defect, reintroduced");
    assert.equal(results.length, SUITES.length);
  });

  test("the report carries the COMPLETE failure set, not just the first", () => {
    const results = runMatrix(SUITES, (suite) => ({
      code: suite === "test:one" || suite === "test:four" ? 1 : 0,
      ms: 1,
    }));
    assert.deepEqual(failed(results).map((r) => r.suite), ["test:one", "test:four"]);
    const summary = renderSummary(results);
    assert.match(summary, /test:one/);
    assert.match(summary, /test:four/);
    assert.match(summary, /2 FAILING SUITES/);
    assert.match(renderStepSummary(results), /test:four/);
  });

  test("exit status still fails the build when any suite failed", () => {
    const allPass: SuiteResult[] = SUITES.map((suite) => ({ suite, status: "PASS", code: 0, ms: 1 }));
    assert.equal(exitCodeFor(allPass), 0);
    assert.equal(
      exitCodeFor([...allPass, { suite: "test:five", status: "FAIL", code: 1, ms: 1 }]),
      1,
      "reporting every suite must not turn a red matrix green",
    );
  });

  test("a suite that could not be spawned counts as failed, not as absent", () => {
    const results = runMatrix(["test:one"], () => ({ code: 127, ms: 0 }));
    assert.equal(results[0].status, "FAIL");
    assert.equal(exitCodeFor(results), 1);
  });
});

describe("CI runs the matrix runner, not the fail-fast chain", () => {
  test("the workflow exists where this guard expects it", () => {
    assert.ok(existsSync(CI_YML), `${CI_YML} not found — this guard would be vacuous`);
  });

  test("the full-matrix step invokes pnpm test:matrix", () => {
    const yml = readFileSync(CI_YML, "utf8");
    assert.match(yml, /run:\s*pnpm test:matrix\b/, "CI no longer runs the matrix runner");
  });

  test("no CI step falls back to the bare && chain", () => {
    // `test:all` stays fail-fast on purpose, for local use. A CI step that runs
    // it directly reports one failure and hides the rest — the original defect.
    const yml = readFileSync(CI_YML, "utf8");
    const offenders = yml
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^\s*(run:\s*)?pnpm test:all\s*$/.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    assert.deepEqual(offenders, [], `CI runs the fail-fast chain:\n${offenders.join("\n")}`);
  });

  test("test:all itself is still the fail-fast chain developers rely on", () => {
    assert.match(pkg.scripts["test:all"], /&&/, "test:all must stay a fail-fast chain");
    assert.match(pkg.scripts["test:matrix"], /run-test-matrix/);
  });
});

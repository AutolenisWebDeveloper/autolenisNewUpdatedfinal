// PHASE 1 ENFORCEMENT OBJECT 3 — the `credit_applications` freeze.
//
// LANDING HERE, NOT IN PHASE 1. §8.2 Phase 1 specifies this test and §11.5 ruling 9
// fixes Phase 1 at exactly three enforcement objects, but only two shipped: the
// one-open-per-buyer partial unique index and the five-candidate cap triggers. This
// file is the third. The route half — `POST /api/buyer/financing/apply` as a
// bodyless 410 — DID land, in Phase 0, so no SSN write path was ever open while
// this was missing; what was missing is the control that stops it being reopened.
// §8.1a records the correction; ruling 9's "three, exactly as C1 constrains" is
// satisfied at the end of Phase 2.
//
// WHAT IT ENFORCES. §2: the platform "contains an internal credit-application model
// that stores encrypted SSN, income, employment, and date of birth… **[RETIRE]** —
// no route in the buy transaction may read or write it." The model is frozen: the
// references that exist today are allowlisted, each tagged with the phase that
// removes it (Phase 7), and any NEW reference fails the build.
//
// THE SCAN IS REPOSITORY-WIDE, ON PURPOSE. §8.2 Phase 1 records that an earlier
// draft scanned a hand-listed set of route and service trees "that could not see
// three of the four reference sites its own allowlist named — the admin
// financing-review routes, the admin pages and the components/admin control all sit
// outside it — so the guard would have passed while the references it exists to
// track were invisible." That draft also listed `lib/services/deposit/**`, a
// directory that does not exist. Scanning everything and allowlisting explicitly is
// the only version of this test that can be trusted, and it costs nothing.
//
// IT PARSES, IT DOES NOT GREP. The retired apply route's own header comment
// discusses `credit_applications` and `CreditApplication` at length — deliberately,
// so a reader knows what was removed and why. A string scan would fail on that
// prose, and the only way to make it pass would be to delete the explanation. So
// this walks the TypeScript AST: comments are not nodes, and a real reference
// cannot hide inside one. Same technique as `lib/security/__tests__/no-ssn-intake.test.ts`,
// and the detector is tested below — a scanner that cannot fail passes forever.
//
// THE APPLY ROUTE IS DELIBERATELY NOT ALLOWLISTED. If the write path is ever
// restored there, the build fails. That is the standing guarantee.
//
// Run: pnpm test:migrations

import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const ROOTS = ["app", "lib", "components", "scripts"] as const;

/** The Prisma model, its table, and the delegate name. Whole tokens only. */
const FROZEN = /^(CreditApplication|creditApplication|credit_applications|CreditApplicationStatus)$/;

/**
 * Every reference that exists today, with the phase that removes it.
 *
 * Enumerated from the tree, not transcribed: the test below re-derives the set and
 * fails if the allowlist and the tree disagree in EITHER direction — a new
 * reference (the guard's whole point) or a STALE entry naming a file that no
 * longer references the model (which would silently widen the rule).
 *
 * FOUR FILES, NOT TWELVE. §8.2 Phase 1 enumerates twelve files "verified 2026-09-03"
 * as referencing the model. That list is GREP-derived; eight of the twelve name it
 * only in comments, and the twelfth is the retired apply route, whose header
 * discusses it at length. Under an AST walk exactly four files hold a real
 * reference, and those are the four here. The larger list is not wrong about what
 * the files SAY — it is counting prose. Recorded in §8.1a, because an allowlist
 * with eight entries that reference nothing would fail its own stale-entry check
 * on the day it landed.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; removedInPhase: number; why: string }> = [
  { file: "app/buyer/financing/page.tsx", removedInPhase: 7, why: "buyer financing page — reads existing applications" },
  { file: "lib/services/financing/credit-application.service.ts", removedInPhase: 7, why: "the model's own service — dormant" },
  { file: "lib/services/financing/financing-orchestrator.service.ts", removedInPhase: 7, why: "dormant orchestrator — one read" },
  { file: "lib/services/financing/review-queue.service.ts", removedInPhase: 7, why: "human review over existing rows — status type only" },
];

/**
 * NOT allowlisted, deliberately, and asserted so the omission stays a decision:
 * the one former WRITE path. Its header comment names the model at length; the AST
 * walk is what lets that explanation survive while the reference stays forbidden.
 */
const FORBIDDEN_BY_NAME = "app/api/buyer/financing/apply/route.ts";

interface Ref { file: string; line: number; text: string }

/** AST-visible references to the frozen model in one file. Comments are not nodes. */
function referencesIn(file: string, src: string): Ref[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Ref[] = [];
  const visit = (node: ts.Node): void => {
    let token: string | null = null;
    if (ts.isIdentifier(node)) token = node.text;
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) token = node.text;
    if (token && FROZEN.test(token)) {
      hits.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: token });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return hits;
}

function scan(): Map<string, Ref[]> {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "credit-applications-frozen");
  const byFile = new Map<string, Ref[]>();
  for (const file of files) {
    const refs = referencesIn(file, readFileSync(`${ROOT}/${file}`, "utf8"));
    if (refs.length) byFile.set(file, refs);
  }
  return byFile;
}

test("credit_applications is frozen — no reference outside the allowlist", () => {
  const byFile = scan();
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const offenders = [...byFile.entries()]
    .filter(([file]) => !allowed.has(file))
    .flatMap(([, refs]) => refs.map((r) => `${r.file}:${r.line} (${r.text})`));

  assert.deepEqual(
    offenders,
    [],
    "§2 retires credit_applications: no route in the buy transaction may read or write it. " +
      "A new reference must be justified and added to the allowlist with the phase that removes it — " +
      `or, better, not written. Offenders: ${offenders.join(", ")}`
  );
});

test("every allowlist entry still references the model — a stale entry fails", () => {
  const byFile = scan();
  const stale = ALLOWLIST.filter((a) => !byFile.has(a.file)).map((a) => a.file);
  assert.deepEqual(
    stale,
    [],
    "These files no longer reference credit_applications, so their allowlist entries are stale. " +
      "A stale entry silently widens the rule — remove it. " +
      `Stale: ${stale.join(", ")}`
  );
});

test("every allowlist entry names the phase that removes it", () => {
  for (const entry of ALLOWLIST) {
    assert.equal(entry.removedInPhase, 7, `${entry.file}: §8.2a assigns every remaining read path to Phase 7`);
    assert.ok(entry.why.length > 5, `${entry.file}: an allowlist entry must say why it is there`);
  }
});

test("the retired apply route is NOT allowlisted, and holds no AST reference", () => {
  assert.ok(
    !ALLOWLIST.some((a) => a.file === FORBIDDEN_BY_NAME),
    "the former write path must never be allowlisted — that is the standing guarantee"
  );
  const refs = referencesIn(FORBIDDEN_BY_NAME, readFileSync(`${ROOT}/${FORBIDDEN_BY_NAME}`, "utf8"));
  assert.deepEqual(
    refs,
    [],
    "The retired route names the model only in prose. An AST reference there means the write path is back."
  );
  const src = readFileSync(`${ROOT}/${FORBIDDEN_BY_NAME}`, "utf8");
  assert.ok(/credit_applications/.test(src), "the route's explanation of what was removed must survive");

  // "Never parses a body" is also asserted against the AST, not the text: the
  // route's own header says it never calls `request.json()`, so a string scan for
  // that phrase fails on the explanation — the exact mistake this file exists to
  // avoid making. The structural fact is stronger anyway: the handler ACCEPTS NO
  // PARAMETER, so there is no request object to read a body from.
  const sf = ts.createSourceFile(FORBIDDEN_BY_NAME, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let post: ts.FunctionDeclaration | null = null;
  ts.forEachChild(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "POST") post = n;
  });
  assert.ok(post, "the route must still export a POST handler");
  assert.equal((post as ts.FunctionDeclaration).parameters.length, 0, "the retired handler must accept no request parameter — an SSN that is never parsed cannot be buffered, logged or echoed");

  let readsBody = false;
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      if (m === "json" || m === "text" || m === "formData" || m === "arrayBuffer") readsBody = true;
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(sf, walk);
  assert.equal(readsBody, false, "the retired route must never read a request body");
});

test("the detector sees a real reference and ignores prose — proved both ways", () => {
  const real = `import { prisma } from "@/lib/prisma";\nawait prisma.creditApplication.create({ data: {} });\n`;
  assert.equal(referencesIn("planted.ts", real).length, 1, "a real delegate call must be detected");

  const prose = `// This route used to write a credit_applications row via CreditApplication.\n// It no longer does.\nexport const x = 1;\n`;
  assert.deepEqual(referencesIn("prose.ts", prose), [], "a comment must never trip the guard");

  const near = `const crossnetCreditApplicationish = 1; export { crossnetCreditApplicationish };`;
  assert.deepEqual(referencesIn("near.ts", near), [], "a longer identifier that merely contains the token must not trip it");
});

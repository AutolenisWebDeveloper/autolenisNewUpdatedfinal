// Regression guard — the buy transaction does not collect a Social Security number.
//
// POST /api/buyer/financing/apply used to accept an `ssn` field and write an
// encrypted CreditApplication row for online lender decisioning that was never
// activated. That route is now a bodyless 410 and the form that fed it
// (components/buyer/FinancingApplicationForm.tsx) is gone. This is the control that
// keeps it that way: it fails if any buyer- or dealer-facing route, page, or
// component re-introduces an SSN input.
//
// It parses each file with the TypeScript compiler and inspects the AST rather than
// grepping source text. Comments are not part of the AST, so prose that merely
// MENTIONS an SSN — the retired route's own header does, at length — can never trip
// this guard, and a real `ssn` field can never hide inside one. The detector is
// itself tested below; a scanner that cannot fail would silently pass forever.
//
// OUT OF SCOPE, deliberately: the affiliate W-9 tax intake collects a TIN that may
// be an SSN or an EIN. That is 1099 payout tax compliance, not the purchase of a
// car, and it is asserted to still exist so this guard can never be satisfied by
// deleting the wrong thing.
//
// Run: pnpm test:security

import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Transaction-facing trees: what a buyer or dealer can reach while buying a car. */
const TRANSACTION_ROOTS = [
  "app/api/buyer",
  "app/api/dealer",
  "app/buyer",
  "app/dealer",
  "components/buyer",
  "components/dealer",
];

/**
 * `ssn`, `socialSecurity`, `social_security`, and the rendered phrase "Social
 * Security" — as whole tokens, so an unrelated word merely containing the letters
 * (`xssny`, `crossnet`) does not trip it.
 */
const SSN_TOKEN = /(^|[^a-z0-9])(ssn|social[\s_-]*security)([^a-z0-9]|$)/i;

interface Hit { file: string; line: number; kind: string; text: string }

/** Every .ts/.tsx file under `dir`, excluding test directories. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Report every AST node in `source` whose *code* text names an SSN — identifiers
 * (so `ssn:` in a zod schema or an object literal), quoted property names and
 * string literals (so `"ssn"` and a `name="ssn"` attribute value), template
 * fragments, and rendered JSX text (so a "Social Security number" label). Comments
 * and trivia are not nodes, so they are structurally excluded.
 */
function scanForSsn(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(
    file, source, ts.ScriptTarget.Latest, /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) text = node.text;
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    if (text !== null && SSN_TOKEN.test(text)) {
      hits.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        kind: ts.SyntaxKind[node.kind],
        text: text.trim().slice(0, 100),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// ---------------------------------------------------------------------------
// The detector must work before its "no hits" result means anything.
// ---------------------------------------------------------------------------

test("the scanner detects an SSN field in code", () => {
  const withField = `
    import { z } from "zod";
    const schema = z.object({ ssn: z.string(), amountCents: z.number() });
  `;
  const hits = scanForSsn("probe.ts", withField);
  assert.ok(hits.length > 0, "a zod field named ssn must be detected");
  assert.equal(hits[0]?.kind, "Identifier");
});

test("the scanner detects an SSN in a quoted key, a label, and an input name", () => {
  const tsx = `
    export function F() {
      const body = { "social_security": v };
      return <><label htmlFor="x">Social Security number</label><input name="ssn" /></>;
    }
  `;
  const kinds = scanForSsn("probe.tsx", tsx).map((h) => h.kind);
  assert.ok(kinds.includes("StringLiteral"), "quoted key / attribute value must be detected");
  assert.ok(kinds.includes("JsxText"), "a rendered SSN label must be detected");
});

test("the scanner ignores SSN mentioned only in comments", () => {
  const commentsOnly = `
    // This route used to collect an SSN. It no longer does.
    /* Social Security number — historical note only. */
    /** @deprecated took an ssn field */
    export async function POST(): Promise<Response> { return new Response(null, { status: 410 }); }
  `;
  assert.deepEqual(scanForSsn("probe.ts", commentsOnly), [],
    "comments are not AST nodes and must never trip the guard");
});

// ---------------------------------------------------------------------------
// The invariant.
// ---------------------------------------------------------------------------

test("no transaction route, page, or component collects a Social Security number", () => {
  const scanned: string[] = [];
  const hits: Hit[] = [];
  for (const root of TRANSACTION_ROOTS) {
    for (const file of sourceFiles(root)) {
      scanned.push(file);
      hits.push(...scanForSsn(file, readFileSync(file, "utf8")));
    }
  }

  assert.ok(scanned.length > 50,
    `expected the transaction trees to hold real files; scanned only ${scanned.length}. ` +
    "If the roots moved, fix TRANSACTION_ROOTS — an empty scan must not read as a pass.");

  assert.deepEqual(
    hits, [],
    "A Social Security number must not be collected anywhere in the buy transaction.\n" +
      hits.map((h) => `  ${h.file}:${h.line} [${h.kind}] ${JSON.stringify(h.text)}`).join("\n"),
  );
});

test("the retired credit-application route returns 410 and never parses a body", async () => {
  const file = "app/api/buyer/financing/apply/route.ts";
  const source = readFileSync(file, "utf8");

  assert.deepEqual(scanForSsn(file, source), [],
    "the retired route must not name an SSN in code (its comments may explain the retirement)");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const post = sf.statements.find(
    (st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === "POST",
  );
  assert.ok(post, "POST must still be exported so the route answers 410 rather than 404");

  // No request parameter means there is nothing to read a body from in the first
  // place. Checked on the AST, not the text: the route's header comment explains the
  // retirement in prose that names request.json(), and prose must not fail a test.
  assert.equal(post.parameters.length, 0, "POST must take no request parameter");

  const BODY_READERS = new Set(["json", "formData", "text", "arrayBuffer", "blob", "bytes"]);
  const bodyReads: string[] = [];
  const findBodyReads = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && BODY_READERS.has(node.expression.name.text)) {
      bodyReads.push(node.expression.name.text);
    }
    ts.forEachChild(node, findBodyReads);
  };
  findBodyReads(post);
  assert.deepEqual(bodyReads, [],
    "the handler must not read the request body — an SSN never parsed cannot be " +
      `logged, echoed by a validation error, or buffered (found: ${bodyReads.join(", ")})`);

  const mod: { POST: () => Promise<Response> } = await import("@/app/api/buyer/financing/apply/route");
  const res = await mod.POST();
  assert.equal(res.status, 410, "POST must return 410 Gone");
  assert.equal(await res.text(), "", "the 410 must carry no body");
});

test("the buyer-facing SSN entry surface is gone", () => {
  assert.equal(existsSync("components/buyer/FinancingApplicationForm.tsx"), false,
    "the form that posted an SSN to the retired route must not come back");
});

// ---------------------------------------------------------------------------
// Preservation — this batch removes an intake, never a record or a capability.
// ---------------------------------------------------------------------------

test("historical credit applications are preserved — no schema change", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.ok(/model\s+CreditApplication\s*\{/.test(schema),
    "the CreditApplication model must remain — historical rows stay readable");
  assert.ok(/ssnEncrypted\s+String\?\s+@map\("ssn_encrypted"\)/.test(schema),
    "the encrypted SSN column must remain; retiring the intake deletes nothing");
  assert.ok(/@@map\("credit_applications"\)/.test(schema),
    "the credit_applications table must remain");
});

test("the affiliate W-9 tax intake is out of scope and still present", () => {
  // Payout tax compliance, not the buy transaction. Asserted so that this guard can
  // never be made to pass by removing an unrelated, legitimate collector.
  for (const file of [
    "app/api/affiliate/finance/tax-info/route.ts",
    "app/api/affiliate/onboarding/tax/route.ts",
  ]) {
    assert.ok(existsSync(file), `${file} must remain — affiliate 1099 tax intake is unaffected`);
    assert.ok(/tinType/.test(readFileSync(file, "utf8")),
      `${file} must still accept a TIN type (SSN or EIN) for tax reporting`);
  }
});

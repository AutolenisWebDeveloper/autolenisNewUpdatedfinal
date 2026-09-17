// EVERY FORCED TRANSITION SUPPLIES A REASON — §28.3 #6, §8.2 Phase 10 defect (4):
// "`force` audited with a reason".
//
// ── WHY THIS IS A BUILD-FAILING RULE AND NOT A CODE REVIEW ──────────────────
//
// Phase 10 made `transitionReason` throw when `force` is set and no reason is given.
// That is the right rule — an override whose audit row cannot say WHY is not an
// override, it is a gap with a flag set — but it converts a silent omission into a
// RUNTIME throw on a path that may have no handler.
//
// Two live paths shipped exactly that, and the first independent review found both:
//
//   · `app/api/admin/contract-shield/[reviewId]/route.ts` passed `reason ?? undefined`
//     while the APPROVE action has no reason field in the UI at all. Every approval
//     would have thrown AFTER writing `contractScan.status = PASS` — version approved,
//     scan PASS, deal stranded at CONTRACT_REVIEW, no envelope, buyer never asked to
//     sign.
//   · `app/api/webhooks/stripe/route.ts` passed no reason on the LIVE concierge-fee
//     settlement. The throw would have left `paymentProviderEvent.processed` false, so
//     Stripe would retry the same failure for ever with the money already captured.
//
// Neither was caught by typecheck (the option is optional by design, because most
// transitions derive their reason) and neither was caught by a test. So the rule is
// mechanical now.
//
// ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
//
// For every `advanceDealStatus(..., { force: true, ... })` in `app/` and `lib/`:
//   · a `reason` property must be present, and
//   · it must not be an expression that can evaluate to nothing.
//
// `reason ?? undefined` and `reason: undefined` are REJECTED by name — they were the
// actual defect. A shorthand `{ reason }` or any other expression is accepted, because
// whether that variable is non-empty is a question about the route's validation that a
// syntax scan cannot answer; the pinned list below records which routes guarantee it
// and how, so the claim is written down rather than assumed.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();
const ROOTS = ["app", "lib"] as const;

interface ForcedCall {
  file: string;
  line: number;
  /** The reason expression as written, or null when the property is absent entirely. */
  reasonText: string | null;
  shorthand: boolean;
}

function forcedCalls(): ForcedCall[] {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "forced-transitions-carry-a-reason");
  const out: ForcedCall[] = [];

  for (const file of files) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    if (!src.includes("advanceDealStatus(")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const walk = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "advanceDealStatus"
      ) {
        const opts = node.arguments[2];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          let forced = false;
          let reasonText: string | null = null;
          let shorthand = false;
          for (const prop of opts.properties) {
            const name = prop.name?.getText(sf) ?? "";
            if (name === "force" && ts.isPropertyAssignment(prop)) {
              forced = prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
            }
            if (name === "reason") {
              if (ts.isShorthandPropertyAssignment(prop)) {
                shorthand = true;
                reasonText = "reason";
              } else if (ts.isPropertyAssignment(prop)) {
                reasonText = prop.initializer.getText(sf).replace(/\s+/g, " ").slice(0, 80);
              }
            }
          }
          if (forced) {
            out.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              reasonText,
              shorthand,
            });
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sf, walk);
  }
  return out;
}

/** Expressions that can evaluate to nothing, and therefore throw at runtime. */
function canBeEmpty(reasonText: string | null): boolean {
  if (reasonText === null) return true;
  const t = reasonText.trim();
  if (t === "undefined" || t === "null") return true;
  // `x ?? undefined` / `x || undefined` — the shape that shipped the defect.
  if (/\?\?\s*undefined|\|\|\s*undefined|\?\?\s*null/.test(t)) return true;
  return false;
}

test("the scan finds forced call sites — it is not looking at an empty set", () => {
  const calls = forcedCalls();
  assert.ok(
    calls.length >= 8,
    `only ${calls.length} forced advanceDealStatus call sites found — the parse is broken and the rule below is vacuous`,
  );
});

test("§28.3 #6: no forced transition can reach the seam without a reason", () => {
  const offenders = forcedCalls()
    .filter((c) => canBeEmpty(c.reasonText))
    .map((c) => `${c.file}:${c.line} — reason is ${c.reasonText === null ? "ABSENT" : `\`${c.reasonText}\``}`);

  assert.deepEqual(
    offenders,
    [],
    "A forced transition can reach advanceDealStatus with no reason, which THROWS at runtime — " +
      "§28.3 #6 and §8.2 Phase 10 defect (4) require force to be audited with a reason. Supply one " +
      "at the call site; if the operator has nothing to type, state the ACTION as the reason " +
      "(the Contract Shield routes do exactly that). " +
      `Offenders:\n  ${offenders.join("\n  ")}`,
  );
});

test("the rule detects a real gap — proved against a seeded call site", () => {
  // The two shapes that actually shipped, plus the two literal absences, must all be
  // reported. A rule that only caught `ABSENT` would have passed the Contract Shield
  // defect, which is the one that would have broken every approval.
  assert.equal(canBeEmpty(null), true, "an absent reason must be reported");
  assert.equal(canBeEmpty("undefined"), true);
  assert.equal(canBeEmpty("reason ?? undefined"), true, "THE shape that shipped — it must not pass");
  assert.equal(canBeEmpty("reason || undefined"), true);

  // And the converse, so the rule is not simply reporting everything.
  assert.equal(canBeEmpty("reason"), false, "a shorthand from a validated body is accepted");
  assert.equal(canBeEmpty('"Concierge fee settled"'), false);
  assert.equal(canBeEmpty("reason?.trim() ? `x: ${reason}` : \"x\""), false, "a total conditional is accepted");
});

test("call sites that pass a VARIABLE reason declare how it is guaranteed non-empty", () => {
  // A syntax scan cannot know whether a variable holds text. These routes do guarantee
  // it, each by a zod `min(1)` on the request body — written down so the claim is
  // reviewable, and so a NEW variable-reason call site has to be justified rather than
  // silently inheriting this test's blessing.
  const GUARANTEED: Record<string, string> = {
    "app/api/admin/buyers/[buyerId]/journey/reopen/route.ts":
      'schema `reason: z.string().min(1, "Reason is required to reopen a stage")`',
    "app/api/admin/deals/[dealId]/action/route.ts":
      'the route refuses early: `if (!reason?.trim()) return adminError("REASON_REQUIRED", …, 400)`',
    "app/api/admin/payments/concierge-fee/[dealId]/mark-paid/route.ts":
      "schema `reason: z.string().min(1)`",
  };

  const undeclared = [
    ...new Set(
      forcedCalls()
        .filter((c) => c.shorthand)
        .map((c) => c.file)
        .filter((f) => !(f in GUARANTEED)),
    ),
  ].sort();

  assert.deepEqual(
    undeclared,
    [],
    "A forced transition passes a variable `reason` from a route that has not been shown to " +
      "guarantee it is non-empty. Add the validation, then record here HOW it is guaranteed. " +
      `Undeclared:\n  ${undeclared.join("\n  ")}`,
  );
});

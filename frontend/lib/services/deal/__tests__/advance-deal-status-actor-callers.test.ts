// THE MATRIX MUST AGREE WITH THE CALL SITES — derived, not restated.
//
// §28.3 #1 gave `advanceDealStatus` a per-transition actor matrix. The first version of
// that matrix was written from the SPECIFICATION's semantics and shipped contradicting
// the code: `RECAP_PENDING`, `FUNDING_PENDING` and `PICKUP_READINESS` were listed as
// SYSTEM/ADMIN only, while their only real callers pass BUYER or DEALER.
//
// The consequence was not subtle. `advanceIfExitSatisfied` (Stage 10's exit) is awaited
// unguarded, so every dealership reaffirmation would have thrown `TransitionActorError`
// and 500'd — NO DEAL COULD LEAVE `DEALER_CONFIRMATION`, and the same for `RECAP_PENDING`
// via `confirmRecap`. Found by the first independent review, not by any test: the
// existing `phase7-review-boundaries.test.ts` greps source TEXT, and a unit test of the
// matrix would only have asserted the matrix agreed with itself.
//
// SO THIS TEST DERIVES THE ANSWER FROM THE CODE. It parses every `advanceDealStatus`
// call in `app/` and `lib/`, reads the `actorRole` the caller passes, and asserts the
// matrix permits it. A matrix that contradicts a real caller is now a red test rather
// than a production 500.
//
// ── WHAT IT CAN AND CANNOT SEE, stated rather than left to be discovered ────
//
// It reads STATIC values: a string literal, or `X ?? "LITERAL"`. A caller that passes a
// variable is reported as UNRESOLVED and listed — not silently skipped, because a
// silently skipped call site is exactly how the defect above survived. The unresolved
// list is asserted against a pinned set, so a NEW dynamic call site fails this test and
// has to be looked at by a human.
//
// Run: pnpm test:deal-lifecycle (via test:operations' sibling scripts — see package.json)

import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";
import { DEAL_TRANSITION_ACTORS, isTransactionActorRole } from "../transition-authority";

const ROOT = process.cwd();
const ROOTS = ["app", "lib"] as const;

interface CallSite {
  file: string;
  line: number;
  target: string;
  /** null when the caller passes something this scan cannot resolve statically. */
  actorRole: string | null;
}

/**
 * The TARGET status: `"COMPLETED"` or `DealStatus.RECAP_PENDING`.
 *
 * A property access counts here only when the object is the `DealStatus` enum itself.
 * Accepting any property access was the first version's bug and it mattered: it read
 * `params.actor` as the literal string "actor" and reported a false violation, which is
 * the same class of error this whole file exists to catch — a check that resolves
 * something it cannot actually see.
 */
function staticTarget(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "DealStatus"
  ) {
    return node.name.text;
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return staticTarget(node.expression);
  return null;
}

/**
 * The ACTOR role, and ONLY when it is genuinely static: a string literal, or the
 * right-hand default of `x ?? "SYSTEM"`.
 *
 * Anything else — a parameter, a property, a conditional — is `null`, which routes the
 * call site to the pinned UNRESOLVED list where a human decides. Guessing here would
 * defeat the point.
 */
function staticActor(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return staticActor(node.right);
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return staticActor(node.expression);
  return null;
}

function callSites(): CallSite[] {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "advance-deal-status-actor-callers");
  const out: CallSite[] = [];

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
        const target = staticTarget(node.arguments[1]);
        const opts = node.arguments[2];
        let actorRole: string | null = null;
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const prop of opts.properties) {
            if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === "actorRole") {
              actorRole = staticActor(prop.initializer);
            }
          }
        }
        if (target) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          out.push({ file, line, target, actorRole });
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sf, walk);
  }
  return out;
}

test("the scan finds the real call sites — it is not looking at an empty set", () => {
  const sites = callSites();
  assert.ok(
    sites.length >= 15,
    `only ${sites.length} advanceDealStatus call sites found — the parse is broken and every assertion below is vacuous`,
  );
  // And it must resolve a meaningful share of them, or the UNRESOLVED escape hatch has
  // quietly become the whole test.
  const resolved = sites.filter((s) => s.actorRole !== null);
  assert.ok(
    resolved.length >= sites.length / 2,
    `only ${resolved.length}/${sites.length} call sites resolved an actorRole — the resolver stopped working`,
  );
});

test("§28.3 #1: every call site's actorRole is permitted by the matrix for its target", () => {
  const violations = callSites()
    .filter((s) => s.actorRole !== null)
    .filter((s) => {
      const permitted = DEAL_TRANSITION_ACTORS[s.target as keyof typeof DEAL_TRANSITION_ACTORS];
      // An unknown target is a different failure, caught by the test below.
      if (!permitted) return false;
      return !permitted.includes(s.actorRole as never);
    })
    .map(
      (s) =>
        `${s.file}:${s.line} passes ${s.actorRole} → ${s.target}, but the matrix permits only ` +
        `${DEAL_TRANSITION_ACTORS[s.target as keyof typeof DEAL_TRANSITION_ACTORS].join(", ")}`,
    );

  assert.deepEqual(
    violations,
    [],
    "The actor matrix contradicts a real caller. This is not a matrix question — the caller is the " +
      "evidence, and a matrix that refuses it throws TransitionActorError in production on a path " +
      "that has no handler for it. Either the matrix is wrong, or the caller is passing the wrong " +
      `actor and must be changed deliberately. Violations:\n  ${violations.join("\n  ")}`,
  );
});

test("every static actorRole in the tree is one of the four typed roles", () => {
  // The drift this phase found — eleven "BUYER" against one "buyer" — was invisible
  // because the field was an unconstrained string. The type now prevents it at compile
  // time; this asserts it at the call sites the scan can see, including any that reach
  // the seam through an `as` cast.
  const bad = callSites()
    .filter((s) => s.actorRole !== null && !isTransactionActorRole(s.actorRole))
    .map((s) => `${s.file}:${s.line} passes ${JSON.stringify(s.actorRole)}`);
  assert.deepEqual(bad, [], `Non-canonical actor roles:\n  ${bad.join("\n  ")}`);
});

test("dynamic actorRole call sites DECLARE what they can pass, and the matrix permits it", () => {
  // THIS TEST WAS VACUOUS IN ITS FIRST VERSION AND THE PROOF CAUGHT IT.
  //
  // It listed dynamic call sites and asserted only that the LIST had not changed. So
  // when the original defect was seeded back — `RECAP_PENDING: AUTOMATED` — the suite
  // stayed green, because both RECAP_PENDING callers pass a variable and were therefore
  // never checked against the matrix at all. A gate built to catch one specific defect,
  // which did not catch that defect when it was put back.
  //
  // The fix is to make the pin CARRY THE CLAIM. Each dynamic site declares the set of
  // roles its variable can actually hold — read from the parameter's own type — and the
  // matrix must permit every one of them. Now seeding `AUTOMATED` back turns this red,
  // which is the whole point of pinning it.
  const DECLARED: { site: string; target: string; roles: readonly string[]; why: string }[] = [
    {
      site: "lib/services/deal/dealer-reaffirmation.service.ts",
      target: "RECAP_PENDING",
      // `actorRole: "BUYER" | "DEALER" | "SYSTEM" = "BUYER"` — advanceIfExitSatisfied's
      // own signature. Called with "DEALER" at :692 and defaulted to "BUYER" at :816/:880.
      roles: ["BUYER", "DEALER", "SYSTEM"],
      why: "Stage 10's exit fires on whichever party acts last — the dealership's reaffirmation or the buyer's acknowledgement",
    },
    {
      site: "lib/services/deal/deal-recap.service.ts",
      target: "FINANCING_PENDING",
      // `params.actor`, typed "BUYER" | "DEALER" by confirmRecap.
      roles: ["BUYER", "DEALER"],
      why: "Stage 11 completes when BOTH confirm the recap; either confirmation can be the last one",
    },
    {
      site: "lib/services/pickup/pickup-readiness.service.ts",
      target: "PICKUP_READINESS",
      roles: ["BUYER", "DEALER", "SYSTEM", "ADMIN"],
      why: "entered from the coordination path, which carries whichever party scheduled, and from the readiness driver as SYSTEM",
    },
    {
      site: "lib/services/pickup/pickup-coordination.service.ts",
      target: "PICKUP_SCHEDULED",
      roles: ["BUYER", "DEALER"],
      why: "scheduling is a negotiation — either party can land the confirmed appointment",
    },
    {
      site: "lib/services/transaction/cancellation.service.ts",
      target: "FROZEN_PENDING_RELEASE",
      roles: ["SYSTEM", "ADMIN"],
      why: "the orchestration asserts the actor BEFORE running any stop, so a buyer-initiated freeze is refused up front",
    },
    {
      site: "lib/services/deal/deal.service.ts",
      target: "CONTRACT_PENDING",
      roles: ["SYSTEM", "ADMIN"],
      why: "the insurance-gate driver forwards opts.actorRole, defaulted to SYSTEM by the seam",
    },
    {
      site: "lib/services/deal/deal.service.ts",
      target: "FEE_PAID",
      roles: ["SYSTEM", "ADMIN"],
      why: "the fee ladder forwards opts.actorRole, defaulted to SYSTEM by the seam",
    },
  ];

  // 1. Every declared role must be permitted by the matrix. THIS is the assertion that
  //    would have caught the shipped defect.
  const refused: string[] = [];
  for (const d of DECLARED) {
    const permitted = DEAL_TRANSITION_ACTORS[d.target as keyof typeof DEAL_TRANSITION_ACTORS] ?? [];
    for (const role of d.roles) {
      if (!permitted.includes(role as never)) {
        refused.push(
          `${d.site} can pass ${role} → ${d.target}, which the matrix refuses (permits ${permitted.join(", ")}). ${d.why}`,
        );
      }
    }
  }
  assert.deepEqual(
    refused,
    [],
    `A dynamic call site can pass an actor the matrix refuses. In production that is an unguarded ` +
      `TransitionActorError on a path with no handler.\n  ${refused.join("\n  ")}`,
  );

  // 2. And the declarations must still describe the tree — a NEW dynamic site has no
  //    declaration, so it fails here and a human has to read it.
  const unresolved = callSites()
    .filter((s) => s.actorRole === null)
    .map((s) => `${s.file} → ${s.target}`)
    .sort();
  const declaredKeys = DECLARED.map((d) => `${d.site} → ${d.target}`);
  const undeclared = [...new Set(unresolved)].filter((u) => !declaredKeys.includes(u));
  assert.deepEqual(
    undeclared,
    [],
    `A new advanceDealStatus call site passes a DYNAMIC actorRole and has no declaration. Read the ` +
      `variable's type, add it to DECLARED with the roles it can hold and why.\n  ${undeclared.join("\n  ")}`,
  );
});

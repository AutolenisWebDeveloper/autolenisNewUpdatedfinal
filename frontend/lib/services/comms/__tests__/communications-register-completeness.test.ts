// §8.3 COMPLETENESS — every `template_key` in the register has at least one enqueue site.
//
// The `template_key` half of §8.3: "Phase 10 asserts completeness by a table-driven
// test that every `template_key` and `exception_code` in the register has at least
// one enqueue/raise site." The `exception_code` half is
// `lib/services/operations/__tests__/exception-register-completeness.test.ts`.
//
// WHY THIS RULE CANNOT BE A LITERAL SCAN, unlike its exception sibling. An
// exception code IS the literal a raise site writes (`code: "PAYMENT_FAILURE"`).
// A template key is not: the register maps a CONSTANT to a value
// (`REGISTRATION_SUBMITTED: "registration_submitted"`) and every enqueue site
// references the constant (`PHASE_2_TEMPLATES.REGISTRATION_SUBMITTED`), so the
// value `"registration_submitted"` appears nowhere outside the registry. A literal
// scan would report all 79 keys as unwired and be useless; a scan for the constant
// NAME is what matches how the code is actually written.
//
// So a key counts as wired when ANY of
//   · a property access `<SOMETHING>_TEMPLATES.<NAME>` names it,
//   · an ELEMENT access `<SOMETHING>_TEMPLATES[<expr>]` names it in a string inside
//     `<expr>`, or
//   · its literal value appears in code (a raw `templateKey: "…"`, which is legal
//     and used by a few call sites).
// All three are collected from the PARSED source, so a key named only in a comment
// discharges nothing.
//
// THE ELEMENT-ACCESS BRANCH IS NOT HYPOTHETICAL, AND THIS RULE'S FIRST RUN PROVED IT.
// `auction-invitation.service.ts:1220` picks its key with
// `PHASE_5_TEMPLATES[percentElapsed === 50 ? "DEALER_INVITATION_REMINDER_50" : "…_90"]`,
// which is an `ElementAccessExpression`, not a `PropertyAccessExpression`. The first cut of
// this gate saw neither the constant (wrong node kind) nor the value (the VALUE never
// appears; the NAME does, as a string), and reported two keys that are demonstrably wired
// and demonstrably sending. A completeness rule with false positives is worse than a loose
// one: its output stops being read, and the real gaps in the same list go with it.
//
// THE RULE IS PROVED TO FAIL — see the last test, which seeds the removal of a key
// that is wired today and asserts the checker reports it. A completeness gate that
// cannot go red is the Phase 9 defect class exactly, and this is the gate that
// decides whether §27.1 is finished.
//
// Run: pnpm test:comms-outbox

import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";
import { COMMUNICATIONS_REGISTER, allTemplateKeys } from "@/lib/services/comms/state-recheck-registry";
import { REGISTER_DISCHARGE_LEDGER, MAX_LEDGERED_ROWS } from "./register-discharge-ledger";

const ROOT = process.cwd();
const ROOTS = ["app", "lib"] as const;

/** The registry itself necessarily names every key; counting it would pass the rule vacuously. */
const REGISTRY_FILE = "lib/services/comms/state-recheck-registry.ts";

interface Observed {
  /** Property names reached through a `*_TEMPLATES` identifier, e.g. `REGISTRATION_SUBMITTED`. */
  readonly constants: Set<string>;
  /** Raw string literals, for the call sites that pass a key directly. */
  readonly literals: Set<string>;
}

function observe(): Observed {
  const all = sourceFiles(ROOT, [...ROOTS]).filter((f) => f !== REGISTRY_FILE);
  assertScanned(all, 800, "communications-register-completeness");

  // ONLY FILES THAT ACTUALLY ENQUEUE. Tightened after the second independent review: the
  // first cut counted any `*_TEMPLATES.<KEY>` property access, so a key named in a
  // `cancelByKey` helper or a recheck registration discharged its register row without
  // anything sending it. `enqueueOrRaise` is the Phase 7 wrapper around the dispatcher and
  // counts as an enqueue; it is named here rather than resolved, because resolving a wrapper
  // chain is a call-graph problem and this rule is deliberately not one.
  const files = all.filter((f) => {
    const src = readFileSync(`${ROOT}/${f}`, "utf8");
    return src.includes("enqueueTransactional") || src.includes("enqueueOrRaise");
  });
  assert.ok(
    files.length >= 15,
    `only ${files.length} files enqueue at all — the filter is wrong and this rule is now blind`
  );

  const constants = new Set<string>();
  const literals = new Set<string>();

  for (const file of files) {
    const src = readFileSync(`${ROOT}/${file}`, "utf8");
    // Cheap pre-filter: most files mention neither, and parsing ~1k files is the
    // slow part of this rule.
    if (!src.includes("_TEMPLATES") && !src.includes("templateKey") && !src.includes("template:")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const walk = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.endsWith("_TEMPLATES")
      ) {
        constants.add(node.name.text);
      }
      // `TEMPLATES[expr]` — every string ANYWHERE inside `expr` is a candidate name, which
      // covers the conditional form without trying to evaluate it. Over-collecting here is
      // safe in the direction that matters: a string that is not a registry key matches
      // nothing, while missing one reports a wired key as unwired.
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.endsWith("_TEMPLATES")
      ) {
        const collect = (n: ts.Node): void => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) constants.add(n.text);
          ts.forEachChild(n, collect);
        };
        collect(node.argumentExpression);
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sf, walk);
  }

  assert.ok(
    constants.size > 0,
    "no `*_TEMPLATES.<KEY>` property access was found anywhere outside the registry — the parse failed and this rule is blind"
  );
  return { constants, literals };
}

/** Constants recorded in the ledger as discharged some other way — see that file. */
const LEDGERED = new Set(REGISTER_DISCHARGE_LEDGER.map((e) => e.constantName));

/**
 * Registered keys with neither a constant reference nor a literal use AND no ledger entry.
 *
 * A ledgered key is not "wired" — it is ACCOUNTED FOR, which is a weaker and different claim,
 * and one the assertions below police from the other side.
 */
function unwired(seen: Observed): string[] {
  const missing: string[] = [];
  for (const [registryName, registry] of Object.entries(COMMUNICATIONS_REGISTER)) {
    for (const [constantName, key] of Object.entries(registry as Record<string, string>)) {
      if (seen.constants.has(constantName)) continue;
      if (seen.literals.has(key)) continue;
      if (LEDGERED.has(constantName)) continue;
      missing.push(`${registryName}.${constantName} (${key})`);
    }
  }
  return missing.sort();
}

test("the register is non-empty and every key is distinct", () => {
  const keys = allTemplateKeys();
  assert.ok(keys.length >= 60, `the communications register holds only ${keys.length} keys — it has lost entries`);
  assert.equal(
    new Set(keys).size,
    keys.length,
    "two registry entries share a template_key. `comms_outbox.template_key` partitions the transactional rail from the CRM rail and identifies the message; a collision makes two different messages indistinguishable in the outbox."
  );
});

test("§8.3 — every registered template_key has at least one enqueue site", () => {
  const missing = unwired(observe());
  assert.deepEqual(
    missing,
    [],
    "§27 requires every transaction communication to dispatch through the durable outbox, and §8.3 makes " +
      "Phase 10 assert that the register is fully wired. These keys are registered but nothing enqueues " +
      "them — the register describes messages the system never sends. Enqueue them through " +
      "enqueueTransactional(), or remove the registry entry with a recorded reason. " +
      `Unwired: ${missing.join(", ")}`
  );
});

test("the rule detects a real gap — proved against a seeded omission", () => {
  const seen = observe();

  const wiredConstants = Object.values(COMMUNICATIONS_REGISTER)
    .flatMap((r) => Object.keys(r as Record<string, string>))
    .filter((name) => seen.constants.has(name));
  assert.ok(
    wiredConstants.length > 0,
    "no registered key has an enqueue site at all — the scan is broken and every assertion above is vacuous"
  );

  const victim = wiredConstants[0]!;
  const seededConstants = new Set(seen.constants);
  seededConstants.delete(victim);
  // The victim's VALUE must go too, or a literal use would mask the seeded removal
  // and the proof would pass without proving anything.
  const victimKey = Object.values(COMMUNICATIONS_REGISTER)
    .flatMap((r) => Object.entries(r as Record<string, string>))
    .find(([name]) => name === victim)?.[1];
  const seededLiterals = new Set(seen.literals);
  if (victimKey) seededLiterals.delete(victimKey);

  const reported = unwired({ constants: seededConstants, literals: seededLiterals });
  assert.ok(
    reported.some((entry) => entry.includes(victim)),
    `seeding the removal of ${victim} did not make the checker report it — the rule cannot fail, so its passing means nothing`
  );

  assert.ok(
    !unwired(seen).some((entry) => entry.includes(victim)),
    `${victim} is reported as unwired even though it has an enqueue site — the checker reports indiscriminately`
  );
});

// ── THE ELEMENT-ACCESS BRANCH, PROVED ───────────────────────────────────────
//
// A branch added to fix a false positive is itself untested unless something asserts it.
// This pins the real call site rather than a fixture, so deleting the branch — or the site
// — is what makes it go red.

test("a key reached through TEMPLATES[expr] counts as wired", () => {
  const seen = observe();
  for (const name of ["DEALER_INVITATION_REMINDER_50", "DEALER_INVITATION_REMINDER_90"]) {
    assert.ok(
      seen.constants.has(name),
      `${name} is enqueued through \`PHASE_5_TEMPLATES[…]\` in auction-invitation.service.ts and the ` +
        `scan did not see it. Either the element-access branch was removed, or the call site was — ` +
        `and those need opposite responses.`
    );
  }
});

// ── THE DISCHARGE LEDGER, HELD SHUT ─────────────────────────────────────────

test("every ledgered row names a real registry key, a reason, a current sender and a follow-up", () => {
  assert.ok(
    REGISTER_DISCHARGE_LEDGER.length <= MAX_LEDGERED_ROWS,
    `${REGISTER_DISCHARGE_LEDGER.length} register rows are discharged without an enqueue site; the ` +
      `pinned ceiling is ${MAX_LEDGERED_ROWS}. Raising it is a decision about what §27.1 means and ` +
      `belongs in a batch, not in the change that needed one more exemption.`
  );

  const byConstant = new Map<string, string>();
  for (const registry of Object.values(COMMUNICATIONS_REGISTER)) {
    for (const [name, key] of Object.entries(registry as Record<string, string>)) byConstant.set(name, key);
  }

  for (const entry of REGISTER_DISCHARGE_LEDGER) {
    const registeredKey = byConstant.get(entry.constantName);
    assert.ok(
      registeredKey,
      `${entry.constantName} is ledgered and is not in the register at all — a ledger entry for a key ` +
        `that does not exist silences nothing and hides the fact that it was removed.`
    );
    assert.equal(
      registeredKey,
      entry.templateKey,
      `${entry.constantName}: the ledger records template_key "${entry.templateKey}" and the register ` +
        `says "${registeredKey}". One of the two has been edited without the other.`
    );
    assert.ok(
      entry.reason.trim().length >= 200,
      `${entry.constantName}: a discharge needs a reason someone can disagree with, not a label. ` +
        `Got ${entry.reason.trim().length} characters.`
    );
    assert.ok(
      entry.sentBy.trim().length > 0,
      `${entry.constantName}: say how the message reaches its recipient TODAY. If the answer is ` +
        `"it does not", this is not a discharge — it is an unimplemented row.`
    );
    assert.ok(
      entry.followUp.trim().length > 0,
      `${entry.constantName}: name what would discharge this properly, so it reads as a tracked item ` +
        `rather than as an exemption.`
    );
  }
});

test("a ledgered row that GAINS an enqueue site is reported — the ledger cannot rot", () => {
  const seen = observe();
  const contradictory = REGISTER_DISCHARGE_LEDGER.filter(
    (e) => seen.constants.has(e.constantName) || seen.literals.has(e.templateKey)
  ).map((e) => e.constantName);

  assert.deepEqual(
    contradictory,
    [],
    "These keys are recorded in the ledger as having NO enqueue site, and one now exists. Delete the " +
      "ledger entry — a stale exemption is how a register stops describing the system. " +
      `Contradictory: ${contradictory.join(", ")}`
  );
});

test("the ledger check itself can fail — proved against a seeded contradiction", () => {
  const seen = observe();
  assert.ok(
    REGISTER_DISCHARGE_LEDGER.length > 0,
    "nothing is ledgered, so the two assertions above are vacuous. Delete them rather than leaving a " +
      "rule that cannot fail."
  );

  const victim = REGISTER_DISCHARGE_LEDGER[0]!;
  const seededConstants = new Set(seen.constants);
  seededConstants.add(victim.constantName);
  const contradictory = REGISTER_DISCHARGE_LEDGER.filter((e) => seededConstants.has(e.constantName));
  assert.ok(
    contradictory.some((e) => e.constantName === victim.constantName),
    `seeding an enqueue site for the ledgered key ${victim.constantName} did not make the check report it`
  );

  // And the two rules must not contradict each other: a ledgered key is never ALSO reported
  // as unwired, or the register could never be green.
  assert.ok(
    !unwired(seen).some((entry) => entry.includes(victim.constantName)),
    `${victim.constantName} is ledgered and is still reported as unwired — the two rules disagree`
  );
});

// §8.3 COMPLETENESS — every `exception_code` in the register has at least one raise site.
//
// §8.3: "Phase 10 asserts completeness by a table-driven test that every
// `template_key` and `exception_code` in the register has at least one
// enqueue/raise site." This is the `exception_code` half; the `template_key` half
// is `lib/services/comms/__tests__/communications-register-completeness.test.ts`.
//
// WHY THE REGISTER IS THE TABLE AND NOT A HAND-WRITTEN LIST. `exception-catalogue.ts`
// already holds all 48 §26 rows plus the entries the Markdown states outside §26.
// Driving the assertion off `EXCEPTION_CATALOGUE` itself means a code added to the
// register tomorrow is covered by this rule the moment it is added — nobody has to
// remember to extend a second list, which is the failure mode §8.3 exists to close.
//
// WHY STRING LITERALS AND NOT grep. A code named in a comment — `// TODO: raise
// PAYMENT_FAILURE here` — satisfies a grep and satisfies nothing else. The scan
// parses each file and collects only literals that appear in CODE, so prose cannot
// discharge a register row. `stringLiterals` (lib/testing/source-scan.ts) does the
// parse; `ts.forEachChild` never descends into trivia.
//
// THE RULE IS PROVED TO FAIL. The last test seeds a deliberately unwired code and
// asserts the checker reports it. Phase 9 shipped a gate that asserted
// `complete === true` against a fixture that could not have been incomplete; a
// completeness rule that cannot fail is worse here than anywhere else, because
// this is the rule the other nine phases are measured by.
//
// ── WHAT THIS RULE CANNOT SEE, STATED RATHER THAN DISCOVERED LATER ──────────
//
// It proves a code HAS a raise site. It does NOT prove anything CALLS that site.
//
// That is not a hypothetical limit. Phase 10 found `flagSuspectedNoShows`
// (`pickup-reminders.service.ts`) — written in Phase 9, exported, tested, documented,
// raising §26's `PICKUP_MISSED`, and with NO CALLER ANYWHERE. This rule counted
// `PICKUP_MISSED` as satisfied the whole time, because the literal was there; the
// exception could never actually fire. It was found by reading the callers, not by
// this gate, and the caller was added in the same phase.
//
// Closing the gap properly needs reachability analysis from the cron and route entry
// points — a real call graph, not a scan — and that is not built here. So the honest
// contract is: this gate stops a register row from having NO implementation, and a
// human still has to check that the implementation runs. Saying so is the difference
// between a limit and a hole.
//
// ── AND WHAT "HAS A RAISE SITE" TURNED OUT TO MEAN ──────────────────────────
//
// Wiring the register found three rows for which the literal rule is the wrong rule, and
// the catalogue now says so per row through `dischargedBy` (see its comment there — the
// reason lives with the register, not in an allowlist here). Two are rendering rules with
// owner SYSTEM and no deadline, satisfied by behaviour and proven by a named test; one has
// no detectable trigger because the capability that produces it was never built.
//
// This file does not decide that — it ENFORCES it, in both directions:
//   · a discharged row that gains a raise site FAILS, so the list cannot rot;
//   · a BEHAVIOUR discharge whose proving test no longer exists FAILS;
//   · an UNBUILT discharge must name a §10 parity row and its owning phase;
//   · the number of discharged rows is PINNED, so a fourth cannot be added in passing.
//
// A discharge is therefore more expensive to add than a raise site, which is the correct
// direction for the incentive to point.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sourceFiles, assertScanned, stringLiterals } from "@/lib/testing/source-scan";
import { EXCEPTION_CATALOGUE } from "@/lib/services/operations/exception-catalogue";

const ROOT = process.cwd();
const ROOTS = ["app", "lib"] as const;

/**
 * The catalogue file itself is excluded: it necessarily contains every code as a
 * literal, so leaving it in would make the rule pass unconditionally — the exact
 * vacuous-pass shape `assertScanned` exists to prevent, one level up.
 */
const CATALOGUE_FILE = "lib/services/operations/exception-catalogue.ts";

/**
 * Literals from files that ACTUALLY CALL `raiseException`.
 *
 * Tightened after the second independent review. The first cut collected every string literal
 * in `app/` and `lib/`, so a code named in an allowlist, a UI map or a suppression set
 * discharged its register row without anything raising it. The review checked empirically and
 * found nothing vacuous at the time — but `SUPPRESSION_EXEMPT_CODES` in
 * `exception-lineage.service.ts` is exactly that shape, and it was added in this same phase.
 *
 * Restricting the scan to files that call the writer is not a full reachability analysis (the
 * limit stated above still stands) but it does close the cheapest way to fool this rule.
 */
function raiseSiteLiterals(): Set<string> {
  const all = sourceFiles(ROOT, [...ROOTS]).filter((f) => f !== CATALOGUE_FILE);
  assertScanned(all, 800, "exception-register-completeness");

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const files = all.filter((f) => readFileSync(`${ROOT}/${f}`, "utf8").includes("raiseException"));
  assert.ok(
    files.length >= 20,
    `only ${files.length} files call raiseException — the filter is wrong and this rule is now blind`
  );

  const literals = stringLiterals(ROOT, files);
  assert.ok(
    literals.size > 200,
    `the literal scan collected only ${literals.size} strings — the parse failed and this rule is now blind`
  );
  return literals;
}

/**
 * Registered codes with no literal anywhere outside the catalogue AND no recorded
 * discharge. A discharged row is not "wired" — it is accounted for, which is a different
 * claim and is checked separately below.
 */
function unwired(literals: ReadonlySet<string>): string[] {
  return EXCEPTION_CATALOGUE.filter((d) => !literals.has(d.code) && !d.dischargedBy)
    .map((d) => d.code)
    .sort();
}

/** How many rows may carry a discharge. Pinned so a fourth cannot appear unnoticed. */
const MAX_DISCHARGED_ROWS = 3;

test("the register is non-empty and every entry is well-formed", () => {
  assert.ok(
    EXCEPTION_CATALOGUE.length >= 48,
    `§26 has 48 rows; the catalogue holds ${EXCEPTION_CATALOGUE.length}. A shrunken register would make the completeness rule below trivially satisfiable.`
  );
  for (const d of EXCEPTION_CATALOGUE) {
    assert.ok(d.code.length > 0, "an entry must have a code");
    assert.ok(d.ownerRole, `${d.code}: §26 requires an owner`);
    assert.ok(d.requiredResult.length > 0, `${d.code}: §26 requires a required result`);
  }
});

test("§8.3 — every registered exception_code has at least one raise site", () => {
  const missing = unwired(raiseSiteLiterals());
  assert.deepEqual(
    missing,
    [],
    "§26 requires every exception to raise through the writer, and §8.3 makes Phase 10 assert it. " +
      "These codes are catalogued but nothing raises them, so the register describes exceptions the " +
      "system cannot actually report. Wire a raise site through raiseException(), or — if the code is " +
      "genuinely not reachable — remove it from the register with a recorded reason. Leaving it here " +
      `is the register claiming a capability that does not exist. Unwired: ${missing.join(", ")}`
  );
});

test("the rule detects a real gap — proved against a seeded omission", () => {
  const literals = raiseSiteLiterals();

  // A code that IS wired today, so removing it from the observed set simulates
  // exactly the regression this rule exists to catch: a raise site deleted while
  // its register row stays behind.
  const wired = EXCEPTION_CATALOGUE.map((d) => d.code).filter((c) => literals.has(c));
  assert.ok(
    wired.length > 0,
    "no registered code has a raise site at all — the scan is broken, and every assertion above is vacuous"
  );

  const victim = wired[0]!;
  const seeded = new Set(literals);
  seeded.delete(victim);

  assert.ok(
    unwired(seeded).includes(victim),
    `seeding the removal of ${victim} did not make the checker report it — the rule cannot fail, so its passing means nothing`
  );

  // And the converse: with the literal restored the same code is not reported, so
  // the rule is not simply reporting everything.
  assert.ok(
    !unwired(literals).includes(victim),
    `${victim} is reported as unwired even though its literal is present — the checker reports indiscriminately`
  );
});

// ── THE DISCHARGE LEDGER — the escape hatch, held shut ───────────────────────

test("every discharged row states a reason, and a BEHAVIOUR discharge names a test that exists", () => {
  const discharged = EXCEPTION_CATALOGUE.filter((d) => d.dischargedBy);

  assert.ok(
    discharged.length <= MAX_DISCHARGED_ROWS,
    `${discharged.length} register rows are discharged without a raise site; the pinned ceiling is ` +
      `${MAX_DISCHARGED_ROWS}. Raising this number is a decision about what the register means and ` +
      `belongs in a batch, not in the change that needed one more exemption. Discharged: ` +
      discharged.map((d) => d.code).join(", ")
  );

  for (const d of discharged) {
    const disc = d.dischargedBy!;
    assert.ok(
      disc.reason.trim().length >= 80,
      `${d.code}: a discharge needs a reason someone can disagree with, not a label. ` +
        `Got ${disc.reason.trim().length} characters.`
    );

    if (disc.kind === "BEHAVIOUR") {
      assert.ok(
        existsSync(join(ROOT, disc.provenBy)),
        `${d.code} is discharged as a BEHAVIOUR proven by ${disc.provenBy}, and that file does not ` +
          `exist. The proof is the whole discharge — without it the row is simply unimplemented.`
      );
    } else {
      assert.ok(
        disc.parityRow.trim().length > 0,
        `${d.code}: an UNBUILT discharge must name the §10 parity row that would build the trigger.`
      );
      assert.ok(
        Number.isInteger(disc.ownedByPhase) && disc.ownedByPhase > 0,
        `${d.code}: an UNBUILT discharge must name the phase that owns building it.`
      );
    }
  }
});

test("a discharged row that GAINS a raise site is reported — the ledger cannot rot", () => {
  const literals = raiseSiteLiterals();
  const contradictory = EXCEPTION_CATALOGUE.filter((d) => d.dischargedBy && literals.has(d.code))
    .map((d) => d.code)
    .sort();

  assert.deepEqual(
    contradictory,
    [],
    "These codes are recorded in the catalogue as discharged WITHOUT a raise site, and a raise " +
      "site now exists for them. One of the two is wrong. If the raise site is real, delete the " +
      `\`dischargedBy\` entry — a stale exemption is how a register stops describing the system. ` +
      `Contradictory: ${contradictory.join(", ")}`
  );
});

test("the discharge check itself can fail — proved against a seeded contradiction", () => {
  const literals = raiseSiteLiterals();
  const discharged = EXCEPTION_CATALOGUE.filter((d) => d.dischargedBy);
  assert.ok(
    discharged.length > 0,
    "no row is discharged, so the two assertions above are vacuous. Delete them rather than " +
      "leaving a rule that cannot fail."
  );

  // Seed the contradiction the previous test exists to catch: a discharged code whose
  // literal HAS appeared in source.
  const victim = discharged[0]!.code;
  const seeded = new Set(literals);
  seeded.add(victim);

  const contradictory = EXCEPTION_CATALOGUE.filter((d) => d.dischargedBy && seeded.has(d.code)).map((d) => d.code);
  assert.ok(
    contradictory.includes(victim),
    `seeding a raise site for the discharged code ${victim} did not make the check report it`
  );

  // And a discharged row must NOT be counted as unwired — otherwise the two rules
  // contradict each other and the register can never be green.
  assert.ok(
    !unwired(literals).includes(victim),
    `${victim} is discharged and is still being reported as unwired — the two rules disagree`
  );
});

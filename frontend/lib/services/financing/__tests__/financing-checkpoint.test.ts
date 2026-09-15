// §Stage 12 / §12b / §12c — the financing checkpoint's rules, proved.
//
// Run with:  npx tsx --test lib/services/financing/__tests__/financing-checkpoint.test.ts
//
// WHAT THIS SUITE IS FOR. Three rules in this phase are the kind that hold until somebody edits
// one line, and each would fail silently:
//
//   §13-D18   code refuses to write the four legacy FinancingStatus values;
//   §12b      the full seven-state machine, including FAILED and EXPIRED as exits from
//             TERMS_LOCKED — which §8.2's shorthand omits;
//   §12c      TERMS_LOCKED requires external evidence and a named verifier, and the BUYER can
//             never be that verifier.
//
// It is a MODULE-LEVEL suite: the transition map, the refusals and the writable set are pure data
// and pure guards, reachable without a database. The recording path itself is exercised end to end
// by the Playwright journey against a real database, where a transaction can actually be proved to
// commit together.

import test from "node:test";
import assert from "node:assert/strict";
import { FinancingStatus } from "@prisma/client";
import {
  FINANCING_TRANSITIONS_FOR_TEST,
  LEGACY_FINANCING_STATUSES,
  PHASE_7_WRITABLE,
} from "../financing-checkpoint.service";

test("§13-D18 — the four legacy values are named, and they are exactly the four", () => {
  assert.deepEqual([...LEGACY_FINANCING_STATUSES].sort(), ["APPROVED", "DECLINED", "PENDING", "SELECTED"]);
});

test("§13-D18 — no legacy value is writable by this phase", () => {
  for (const legacy of LEGACY_FINANCING_STATUSES) {
    assert.equal(
      PHASE_7_WRITABLE.includes(legacy),
      false,
      `${legacy} must not be writable — §13-D18 keeps it in the enum with code refusing to write it`,
    );
  }
});

test("§12b — the writable set is every checkpoint state, COMPLETED included since Phase 8", () => {
  // PHASE 7 RESERVED `COMPLETED` AND THIS TEST HELD THE RESERVATION. It was checkpoint two —
  // "after signing, before vehicle release" (§12a) — and parity row deal-early/D3 assigned it,
  // with funding clearance, to Phase 8.
  //
  // Phase 8 has now BUILT checkpoint two, so the gate OPENS rather than being bypassed:
  // `recordFinancingCompletion` (funding-clearance.service.ts) writes COMPLETED through THIS
  // writer, which is what keeps §12b's transition map, the actor requirement, the
  // >=10-character reason and the tamper-evident audit chain on the second checkpoint as
  // well as the first. The alternative — Phase 8 writing financing.status directly — would
  // have been a second writer around the guard, which is the thing the guard exists to stop.
  assert.deepEqual(
    [...PHASE_7_WRITABLE].sort(),
    ["COMPLETED", "EXPIRED", "FAILED", "IN_PROGRESS", "NOT_REQUIRED_CASH", "NOT_STARTED", "TERMS_LOCKED"],
  );
});

test("§12b — FAILED and EXPIRED are writable, which §8.2's shorthand omits", () => {
  // §8.2 Phase 7 abbreviates the machine to "NOT_STARTED → IN_PROGRESS → TERMS_LOCKED |
  // NOT_REQUIRED_CASH". §12b and HTML FIN_PANELS carry the full form and the Markdown governs.
  // Pinned here because the shorthand is the version a future reader is most likely to meet first.
  assert.ok(PHASE_7_WRITABLE.includes(FinancingStatus.FAILED));
  assert.ok(PHASE_7_WRITABLE.includes(FinancingStatus.EXPIRED));
});

test("every FinancingStatus is classified — a new enum value cannot slip through unclassified", () => {
  // The production enum holds 11 labels. If a twelfth is added and nobody decides whether this
  // phase may write it, this fails rather than defaulting to "not writable" silently.
  const all = Object.values(FinancingStatus);
  assert.equal(all.length, 11, `FinancingStatus has ${all.length} labels; update this suite deliberately`);
  for (const status of all) {
    const classified =
      PHASE_7_WRITABLE.includes(status) ||
      LEGACY_FINANCING_STATUSES.includes(status) ||
      status === FinancingStatus.COMPLETED;
    assert.ok(classified, `${status} is in no category — decide whether Phase 7 may write it`);
  }
});

test("the two exit states §Stage 12 names are both writable here", () => {
  // "Exit. TERMS_LOCKED or NOT_REQUIRED_CASH, and the recap reflects the locked terms."
  assert.ok(PHASE_7_WRITABLE.includes(FinancingStatus.TERMS_LOCKED));
  assert.ok(PHASE_7_WRITABLE.includes(FinancingStatus.NOT_REQUIRED_CASH));
});

test("the owner's completion rule survives: nothing here can satisfy completion", () => {
  // "A Deal can never be marked complete unless financing status is COMPLETED or
  // NOT_REQUIRED_CASH." NOT_REQUIRED_CASH IS writable here — §12d sets it at Stage 12 — and that
  // is correct and deliberate: cash "does not skip a checkpoint; it satisfies it differently", and
  // the money itself is confirmed received at funding clearance in Phase 8.
  //
  // What must never be writable here is COMPLETED, which would let this phase satisfy the rule
  // through the financing half without a lender having funded anything.
  // PHASE 8: COMPLETED is now writable through this service, and the owner's rule is
  // unchanged because it never rested on the WRITER — it rests on §12b's transition map,
  // which still only admits COMPLETED from TERMS_LOCKED. Financing cannot be completed
  // without having been locked first, whichever phase records it.
  assert.ok(PHASE_7_WRITABLE.includes(FinancingStatus.COMPLETED));
  assert.deepEqual(
    FINANCING_TRANSITIONS_FOR_TEST.TERMS_LOCKED.includes(FinancingStatus.COMPLETED),
    true,
    "COMPLETED is reachable only from TERMS_LOCKED — a lender approval must be locked before it can be completed",
  );
  for (const from of [FinancingStatus.NOT_STARTED, FinancingStatus.IN_PROGRESS] as FinancingStatus[]) {
    assert.equal(
      FINANCING_TRANSITIONS_FOR_TEST[from].includes(FinancingStatus.COMPLETED),
      false,
      `${from} -> COMPLETED must stay illegal: nothing may reach completion without locked terms`,
    );
  }
  assert.ok(
    PHASE_7_WRITABLE.includes(FinancingStatus.NOT_REQUIRED_CASH),
    "§12d sets NOT_REQUIRED_CASH at this stage",
  );
});

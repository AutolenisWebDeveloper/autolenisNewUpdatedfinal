// Phase 11 acceptance harness — shared scaffolding for the four §34 scenarios.
//
// WHY THIS FILE EXISTS, AND WHAT IT REFUSES TO DO.
//
// §34 asks for four complete transactions through ONE spine, plus every branch it
// lists, plus a measured §26 and §27.1 coverage number. Ten times across ten phases
// this codebase shipped a check that reported success while checking nothing, so the
// rules below are structural rather than advisory:
//
//   1. COVERAGE IS MEASURED, NOT ASSERTED. §8.3's Phase-10 gates prove an exception
//      code HAS a raise site and a template key HAS an enqueue site. They explicitly
//      do NOT prove anything REACHES those sites — `PICKUP_MISSED` counted as
//      satisfied throughout Phase 9 while its only raiser had no caller
//      (§8.1j, "A limit in this phase's own gate"). So this harness never asks the
//      source tree anything. It drives the real services and then reads
//      `queue_items.exception_code` and `comms_outbox.template_key` out of the
//      database. A code appears in the coverage number only if production code wrote
//      a row for it during this run.
//
//   2. NOTHING IS HAND-SET THAT PRODUCTION WOULD WRITE. A fixture that INSERTs
//      `deals.funding_cleared_at` proves the assertion, not the system. Fixtures here
//      create only what a real actor supplies (a person, a vehicle, a dealership);
//      every state transition goes through the owning service.
//
//   3. EVERY SCAN ASSERTS NON-EMPTINESS. `assertNonEmpty` exists because the drift
//      guard that compared two empty sets passed for a whole phase.
//
//   4. THE DATABASE IS PROVED LOCAL BEFORE ANYTHING RUNS. Same DSN-guard convention
//      as `tests/integration/dealer-funnel.itest.ts:22` and
//      `scripts/e2e-admin-storage-state.ts:28`.

import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

// ─── 1. The database must be the throwaway local one ────────────────────────
//
// Checked at import time so no test body can run first. The production project
// reference is named explicitly: the failure mode that matters is a suite pointed
// at production, and that looks exactly like a passing suite until it is too late.

const PRODUCTION_REF = "aieybibvewmvrubcpthm";
const dsn = process.env.DATABASE_URL ?? "";

if (!/autolenis_e2e/.test(dsn)) {
  throw new Error(
    "Phase 11 acceptance refuses to run: DATABASE_URL must target the local autolenis_e2e " +
      `database. Got a DSN whose host is ${hostOf(dsn) || "(unparseable)"}.`,
  );
}
if (dsn.includes(PRODUCTION_REF)) {
  throw new Error(
    "Phase 11 acceptance refuses to run: DATABASE_URL names the PRODUCTION project reference.",
  );
}
if (process.env.COMMS_TRANSPORT !== "capture") {
  throw new Error(
    "Phase 11 acceptance refuses to run: COMMS_TRANSPORT must be 'capture'. The default is " +
      "'live' deliberately (lib/services/comms/transport-mode.ts:20-26), so an unset value here " +
      "would attempt real delivery.",
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export const prisma = new PrismaClient();

// ─── 2. Non-emptiness ───────────────────────────────────────────────────────

/**
 * Refuse a comparison over an empty collection.
 *
 * The §8.4 drift guard passed for a phase because its prefix was two digits short
 * and it compared two empty sets. Any assertion in this suite that walks a
 * collection states its floor here first.
 */
export function assertNonEmpty<T>(items: readonly T[], what: string, min = 1): readonly T[] {
  assert.ok(
    items.length >= min,
    `${what}: expected at least ${min}, got ${items.length}. A comparison over an empty ` +
      "collection passes without checking anything — this is that check, not a size preference.",
  );
  return items;
}

// ─── 3. Measured coverage ───────────────────────────────────────────────────

/** Every §26 code a production raise site actually wrote during this run. */
export async function exceptionCodesRaised(): Promise<string[]> {
  const rows = await prisma.queueItem.findMany({
    where: { exceptionCode: { not: null } },
    select: { exceptionCode: true },
    distinct: ["exceptionCode"],
  });
  return rows.map((r) => r.exceptionCode as string).sort();
}

/** Every §27.1 template key a production enqueue site actually wrote during this run. */
export async function templateKeysEnqueued(): Promise<string[]> {
  const rows = await prisma.commsOutbox.findMany({
    where: { templateKey: { not: null } },
    select: { templateKey: true },
    distinct: ["templateKey"],
  });
  return rows.map((r) => r.templateKey as string).sort();
}

// ─── 4. Assertion discrimination ────────────────────────────────────────────

/**
 * Prove an assertion can fail.
 *
 * §34's whole output is "everything works", which is the single easiest claim to
 * make vacuously. An assertion nobody has seen fail is an assertion nobody has
 * tested. `provesDiscriminating` runs the check against a deliberately broken
 * input and records that it threw — the result is reported as
 * ASSERTION DISCRIMINATION: n of n in ACCEPTANCE-REPORT.md.
 *
 * It throws when the "broken" input does NOT fail, because that is the finding.
 */
export const discrimination: { proven: string[]; unproven: string[] } = { proven: [], unproven: [] };

export function provesDiscriminating(name: string, brokenCase: () => void): void {
  let threw = false;
  try {
    brokenCase();
  } catch {
    threw = true;
  }
  if (threw) {
    discrimination.proven.push(name);
  } else {
    discrimination.unproven.push(name);
    assert.fail(
      `${name}: the assertion did NOT fail when the behaviour it checks was deliberately broken. ` +
        "It therefore proves nothing, and a green result from it is meaningless.",
    );
  }
}

export async function provesDiscriminatingAsync(name: string, brokenCase: () => Promise<void>): Promise<void> {
  let threw = false;
  try {
    await brokenCase();
  } catch {
    threw = true;
  }
  if (threw) {
    discrimination.proven.push(name);
  } else {
    discrimination.unproven.push(name);
    assert.fail(
      `${name}: the assertion did NOT fail when the behaviour it checks was deliberately broken.`,
    );
  }
}

// ─── 5. Unique-but-deterministic fixture identifiers ────────────────────────

let seq = 0;

/**
 * One run id, captured once at module load, plus a monotonic counter.
 *
 * Both halves are deliberate. The counter makes a value reproducible WITHIN a run,
 * so a failure can be traced to a specific fixture. The run id makes it unique
 * ACROSS runs, and that half was added after the first version omitted it: a
 * counter alone produced the same address every run, so the second run re-resolved
 * the FIRST run's buyer, attached to its still-open Vehicle Request, and a
 * scenario assertion failed against a row the current run never wrote. A suite
 * that only passes on a clean database is a suite that will be re-run and
 * disbelieved. No Math.random — the id is printed so a failing run is reproducible
 * by pinning it.
 */
const RUN_ID = process.env.P11_RUN_ID ?? Date.now().toString(36);

export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-p11-${RUN_ID}-${String(seq).padStart(5, "0")}`;
}

/** Printed by the suites so a failing run can be replayed with P11_RUN_ID=<id>. */
export function runId(): string {
  return RUN_ID;
}

// Task 4 — credit-budgeted enrichment.
//
// This is the only place in the system that spends money, so every guarantee
// here is about NOT spending it wrongly:
//
//   preview spends nothing and reports worst case BEFORE any confirmation
//   a hard cap stops the run and records why
//   the spend guard keys on apollo_person_id, so one person is paid for once
//   staleness prevents re-paying for a contact we already have
//   waterfall stays off unless explicitly enabled
//   one credit is DRAWN from ApolloCreditLedger before every paid call, so two
//     runs in one cycle contend for one balance instead of each seeing the
//     full one — and only a clean no-match, the outcome Apollo documents as
//     free, gets its credit back
//   a weakly-matched rooftop is not enriched at all
//
// That last one is not hypothetical. Measured against production, an Apollo
// People Search for SIC 5511 in Texas resolved 13 of 86 organizations (15.1%)
// to an existing rooftop by name. Most of the remainder are parent groups
// ("AutoNation", "Hendrick Automotive Group") whose people cannot be attributed
// to one store. Spending a capped budget against those links would buy contacts
// filed under the wrong dealership, so match confidence gates the spend.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  previewEnrichment,
  runEnrichment,
  resolveMaxCredits,
  ENRICHMENT_STALENESS_DAYS,
  REVEAL_COST_CREDITS,
  WATERFALL_WORST_CASE_MULTIPLIER,
  type EnrichmentCandidate,
  type EnrichmentDeps,
} from "../apollo-enrichment-job.service";

const NOW = new Date("2026-08-31T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function candidate(id: string, over: Partial<EnrichmentCandidate> = {}): EnrichmentCandidate {
  return {
    id: `cand_${id}`,
    apolloPersonId: id,
    rooftopId: `rt_${id}`,
    matchMethod: "name_zip",
    matchConfidence: "high",
    enrichmentStatus: "NEW",
    lastSyncedAt: null,
    priorityTier: 3,
    ...over,
  };
}

/**
 * The fake ApolloCreditLedger. `cap` is the whole budget the draw can see; a
 * draw past it is refused exactly as the real conditional updateMany refuses
 * one. `spent` is what the ledger holds, so a test compares the run's
 * creditsSpent against it directly — that equality is the invariant.
 */
interface FakeLedger {
  cap: number;
  spent: number;
  draws: number;
  refunds: number;
  /** When set, the draw itself throws — the ledger is unreachable, not empty. */
  drawError?: Error;
  /** When set, the refund throws. */
  refundError?: Error;
}

function fakeLedger(cap = 100_000): FakeLedger {
  return { cap, spent: 0, draws: 0, refunds: 0 };
}

interface Harness {
  deps: Partial<EnrichmentDeps>;
  ledger: FakeLedger;
  reveals: () => string[];
  revealOpts: () => { waterfall: boolean }[];
  /** ledger.spent as the reveal fake observed it at the moment it was invoked. */
  spentAtReveal: () => number[];
  contacts: () => Record<string, unknown>[];
  candidateWrites: () => Record<string, unknown>[];
  run: () => Record<string, unknown> | null;
}

function harness(opts: {
  candidates?: EnrichmentCandidate[];
  alreadyEnrichedPersonIds?: string[];
  reveal?: { email: string | null; phone: string | null; dncStatus: string | null; phoneType: string | null } | null;
  waterfallEnabled?: boolean;
  enabled?: boolean;
  ledgerRemaining?: number;
  ledger?: FakeLedger;
}): Harness {
  const reveals: string[] = [];
  const revealOpts: { waterfall: boolean }[] = [];
  const spentAtReveal: number[] = [];
  const contacts: Record<string, unknown>[] = [];
  const candidateWrites: Record<string, unknown>[] = [];
  let run: Record<string, unknown> | null = null;
  const enriched = new Set(opts.alreadyEnrichedPersonIds ?? []);
  const ledger = opts.ledger ?? fakeLedger();

  return {
    ledger,
    reveals: () => reveals,
    revealOpts: () => revealOpts,
    spentAtReveal: () => spentAtReveal,
    contacts: () => contacts,
    candidateWrites: () => candidateWrites,
    run: () => run,
    deps: {
      now: NOW,
      enabled: () => opts.enabled ?? true,
      waterfallEnabled: () => opts.waterfallEnabled ?? false,
      selectCandidates: async () => opts.candidates ?? [candidate("p1")],
      isPersonAlreadyEnriched: async (personId: string) => enriched.has(personId),
      // A READ, deliberately decoupled from the fake ledger below. The balance
      // quoted at run start is an estimate; the tests that matter prove the
      // per-candidate draw protects the budget even when that estimate is
      // stale or plain wrong.
      ledgerRemaining: async () => opts.ledgerRemaining ?? 100_000,
      ledgerDraw: async (cost: number) => {
        if (ledger.drawError) throw ledger.drawError;
        if (ledger.spent + cost > ledger.cap) return { drawn: false, reason: "insufficient" };
        ledger.spent += cost;
        ledger.draws += 1;
        return { drawn: true };
      },
      ledgerRefund: async (cost: number) => {
        if (ledger.refundError) throw ledger.refundError;
        ledger.spent -= cost;
        ledger.refunds += 1;
      },
      reveal: async (personId: string, o: { waterfall: boolean }) => {
        reveals.push(personId);
        revealOpts.push(o);
        spentAtReveal.push(ledger.spent);
        return opts.reveal === undefined
          ? { email: `${personId}@dealer.invalid`, phone: null, dncStatus: "not_found", phoneType: "corporate_phone" }
          : opts.reveal;
      },
      persistContact: async (c) => { contacts.push(c as unknown as Record<string, unknown>); },
      updateCandidate: async (id, data) => { candidateWrites.push({ id, ...data }); },
      persistRun: async (r) => { run = r as unknown as Record<string, unknown>; },
    },
  };
}

let h: Harness;
beforeEach(() => { h = harness({}); });

// ─── preview spends nothing ─────────────────────────────────────────────────

test("preview performs no reveal and reports the candidate count", async () => {
  h = harness({ candidates: Array.from({ length: 40 }, (_, i) => candidate(`p${i}`)) });
  const r = await previewEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 0, "preview must never reveal");
  assert.equal(r.candidateCount, 40);
});

test("preview worst case is candidates x cost, capped by maxCredits", async () => {
  h = harness({ candidates: Array.from({ length: 40 }, (_, i) => candidate(`p${i}`)) });
  const r = await previewEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(r.worstCaseCredits, 40 * REVEAL_COST_CREDITS);
  const capped = await previewEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(capped.worstCaseCredits, 10, "the cap bounds the worst case the admin is shown");
});

test("preview OVER-estimates when waterfall is on — variable cost is never under-reported", async () => {
  h = harness({ candidates: Array.from({ length: 10 }, (_, i) => candidate(`p${i}`)), waterfallEnabled: true });
  const r = await previewEnrichment({ maxCredits: 1000 }, h.deps);
  assert.equal(r.waterfallEnabled, true);
  assert.ok(WATERFALL_WORST_CASE_MULTIPLIER > 1);
  assert.equal(r.worstCaseCredits, 10 * REVEAL_COST_CREDITS * WATERFALL_WORST_CASE_MULTIPLIER);
});

test("preview records itself as a run in preview mode, spending zero", async () => {
  await previewEnrichment({ maxCredits: 50 }, h.deps);
  assert.equal(h.run()?.mode, "preview");
  assert.equal(h.run()?.creditsSpent, 0);
});

// ─── the hard cap ───────────────────────────────────────────────────────────

test("the run ABORTS at the cap, records why, and stops calling Apollo", async () => {
  h = harness({ candidates: Array.from({ length: 50 }, (_, i) => candidate(`p${i}`)) });
  const r = await runEnrichment({ maxCredits: 5 }, h.deps);
  assert.equal(r.status, "ABORTED_CAP");
  assert.equal(r.creditsSpent, 5);
  assert.equal(h.reveals().length, 5, "must stop AT the cap, not after exceeding it");
  assert.match(r.abortReason ?? "", /cap/i);
  assert.match(r.abortReason ?? "", /45 candidate\(s\) not attempted/, "the reason names exactly what was left");
});

test("the effective cap is the MINIMUM of the request, config, and ledger remaining", async () => {
  h = harness({ candidates: Array.from({ length: 50 }, (_, i) => candidate(`p${i}`)), ledgerRemaining: 3 });
  const r = await runEnrichment({ maxCredits: 999 }, h.deps);
  assert.equal(r.creditsSpent, 3, "a job cap can never exceed the monthly ledger");
  assert.equal(r.status, "ABORTED_CAP");
});

test("a zero or negative cap spends nothing", async () => {
  for (const cap of [0, -5]) {
    const local = harness({ candidates: [candidate("p1")] });
    const r = await runEnrichment({ maxCredits: cap }, local.deps);
    assert.equal(local.reveals().length, 0, `cap ${cap} must reveal nothing`);
    assert.equal(r.creditsSpent, 0);
  }
});

test("resolveMaxCredits reads config and refuses a nonsense value", () => {
  const prev = process.env.APOLLO_ENRICHMENT_MAX_CREDITS;
  process.env.APOLLO_ENRICHMENT_MAX_CREDITS = "250";
  assert.equal(resolveMaxCredits(), 250);
  process.env.APOLLO_ENRICHMENT_MAX_CREDITS = "-1";
  assert.ok(resolveMaxCredits() > 0, "a negative config must not disable the cap");
  process.env.APOLLO_ENRICHMENT_MAX_CREDITS = "not a number";
  assert.ok(resolveMaxCredits() > 0);
  if (prev === undefined) delete process.env.APOLLO_ENRICHMENT_MAX_CREDITS;
  else process.env.APOLLO_ENRICHMENT_MAX_CREDITS = prev;
});

// ─── idempotency keys on the PERSON ─────────────────────────────────────────

test("an apollo_person_id already enriched is never enriched again", async () => {
  h = harness({
    candidates: [candidate("p1"), candidate("p2"), candidate("p3")],
    alreadyEnrichedPersonIds: ["p1"],
  });
  await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.deepEqual(h.reveals().sort(), ["p2", "p3"]);
});

test("two candidates for ONE person cause exactly one reveal", async () => {
  // The same Apollo person can surface under two rooftops. A per-prospect guard
  // would pay for them twice; the guard keys on apollo_person_id.
  h = harness({
    candidates: [candidate("dup", { id: "cand_a" }), candidate("dup", { id: "cand_b", rooftopId: "rt_other" })],
  });
  await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 1);
});

// ─── staleness ──────────────────────────────────────────────────────────────

test("a candidate synced inside the staleness window is skipped", async () => {
  h = harness({ candidates: [candidate("p1", { lastSyncedAt: daysAgo(10), enrichmentStatus: "ENRICHED" })] });
  const r = await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 0);
  assert.equal(r.creditsSpent, 0);
});

test("a candidate past the staleness threshold IS re-enriched", async () => {
  h = harness({
    candidates: [candidate("p1", { lastSyncedAt: daysAgo(ENRICHMENT_STALENESS_DAYS + 5), enrichmentStatus: "ENRICHED" })],
  });
  await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 1);
});

// ─── waterfall ──────────────────────────────────────────────────────────────

test("waterfall is OFF by default — no waterfall reaches the reveal", async () => {
  await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(h.revealOpts()[0]?.waterfall, false);
});

test("waterfall is passed only when explicitly enabled", async () => {
  h = harness({ waterfallEnabled: true });
  await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(h.revealOpts()[0]?.waterfall, true);
});

// ─── match confidence gates the spend ───────────────────────────────────────

test("a LOW-confidence rooftop link is not enriched", async () => {
  h = harness({ candidates: [candidate("p1", { matchConfidence: "low" })] });
  const r = await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 0, "a coin-flip link must not be paid for");
  assert.equal(r.skippedWeakMatch, 1);
});

test("a rooftop that was CREATED rather than matched is not enriched by default", async () => {
  // Measured: 73 of 86 Apollo organizations create a rooftop rather than match
  // one. Enriching those buys contacts for dealerships not on the prospect list.
  h = harness({ candidates: [candidate("p1", { matchMethod: "created", matchConfidence: "low" })] });
  const r = await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 0);
  assert.equal(r.skippedWeakMatch, 1);
});

test("an unmatchable candidate is never enriched", async () => {
  h = harness({ candidates: [candidate("p1", { rooftopId: null, matchMethod: "unmatchable", matchConfidence: "low" })] });
  await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(h.reveals().length, 0);
});

test("the weak-match gate can be overridden explicitly, and the run records it", async () => {
  h = harness({ candidates: [candidate("p1", { matchConfidence: "low" })] });
  const r = await runEnrichment({ maxCredits: 100, includeWeakMatches: true }, h.deps);
  assert.equal(h.reveals().length, 1);
  assert.equal(r.includedWeakMatches, true);
});

// ─── outcomes ───────────────────────────────────────────────────────────────

test("a reveal with no email and no phone is UNREACHABLE and fabricates nothing", async () => {
  h = harness({ reveal: { email: null, phone: null, dncStatus: null, phoneType: null } });
  await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(h.contacts()[0]?.email, null);
  assert.equal(h.contacts()[0]?.phone, null);
  assert.equal(h.candidateWrites()[0]?.enrichmentStatus, "UNREACHABLE");
});

test("dnc_status and phone_type are persisted verbatim", async () => {
  h = harness({ reveal: { email: null, phone: "+15125551212", dncStatus: "found", phoneType: "mobile_phone" } });
  await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(h.contacts()[0]?.dncStatus, "found");
  assert.equal(h.contacts()[0]?.phoneType, "mobile_phone");
  assert.ok(h.contacts()[0]?.dncCheckedAt instanceof Date);
});

test("the run record persists actual credits consumed and completes", async () => {
  h = harness({ candidates: [candidate("a"), candidate("b"), candidate("c"), candidate("d")] });
  const r = await runEnrichment({ maxCredits: 100 }, h.deps);
  assert.equal(r.creditsSpent, 4);
  assert.equal(r.status, "COMPLETED");
  assert.equal(h.run()?.creditsSpent, 4);
  assert.equal(h.run()?.mode, "execute");
});

test("candidates are enriched in priority order and the cap cuts the tail", async () => {
  h = harness({
    candidates: [
      candidate("opp", { priorityTier: 1 }),
      candidate("scripted", { priorityTier: 2 }),
      candidate("scored", { priorityTier: 3 }),
      candidate("discovered", { priorityTier: 4 }),
    ],
  });
  await runEnrichment({ maxCredits: 3 }, h.deps);
  assert.deepEqual(h.reveals(), ["opp", "scripted", "scored"]);
});

test("the job aborts cleanly when the enrichment flag is off", async () => {
  h = harness({ enabled: false });
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(r.status, "ABORTED_DISABLED");
  assert.equal(r.creditsSpent, 0);
  assert.equal(h.reveals().length, 0);
});

test("a reveal that throws is recorded FAILED and does not abort the run", async () => {
  const local = harness({ candidates: [candidate("bad"), candidate("good")] });
  let first = true;
  local.deps.reveal = async (personId: string) => {
    if (first) { first = false; throw new Error("apollo 503"); }
    return { email: `${personId}@dealer.invalid`, phone: null, dncStatus: "not_found", phoneType: null };
  };
  const r = await runEnrichment({ maxCredits: 10 }, local.deps);
  assert.equal(r.failedCount, 1);
  assert.equal(r.enrichedCount, 1, "one bad person must not stop the run");
  const failed = local.candidateWrites().find((w) => w.enrichmentStatus === "FAILED");
  assert.match(String(failed?.enrichmentError ?? ""), /apollo 503/);
});

test("a credit is counted for a reveal that throws — Apollo may still have billed", async () => {
  const local = harness({ candidates: [candidate("bad")] });
  local.deps.reveal = async () => { throw new Error("timeout"); };
  const r = await runEnrichment({ maxCredits: 10 }, local.deps);
  assert.equal(r.creditsSpent, 1, "never undercount spend: an errored paid call may have charged");
});

// ─── the draw precedes the call ─────────────────────────────────────────────
//
// Before this batch runEnrichment only TALLIED spend in memory and wrote the
// tally to apollo_enrichment_runs; ApolloCreditLedger was never touched, so two
// runs in one cycle each saw the full balance. Now one credit is drawn
// atomically before every paid call, and the run's creditsSpent is the net of
// what it drew — the number the run row records is the number the ledger moved.

test("one credit is drawn from the ledger BEFORE each paid call — the adapter sees it already taken", async () => {
  h = harness({ candidates: [candidate("a"), candidate("b"), candidate("c")] });
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.deepEqual(h.spentAtReveal(), [1, 2, 3], "at every reveal the ledger already holds that reveal's credit");
  assert.equal(h.ledger.draws, 3);
  assert.equal(r.creditsSpent, 3);
  assert.equal(h.ledger.spent, 3);
});

test("a ledger that refuses mid-run stops the run: SKIPPED_CAP, ABORTED_CAP, the rest unattempted, no further call", async () => {
  // The balance quoted at start says 100 000; the ledger actually has 3. The
  // read at the top of the run is an estimate — the draw is what protects.
  h = harness({
    candidates: ["a", "b", "c", "d", "e"].map((id) => candidate(id)),
    ledger: fakeLedger(3),
  });
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(r.status, "ABORTED_CAP");
  assert.deepEqual(h.reveals(), ["a", "b", "c"], "the 4th candidate must never reach Apollo");
  assert.equal(h.ledger.spent, 3);
  assert.equal(r.creditsSpent, 3);
  assert.match(r.abortReason ?? "", /refused/);
  assert.match(r.abortReason ?? "", /2 candidate\(s\) not attempted/, "d and e were never attempted");

  const skipped = h.candidateWrites().filter((w) => w.enrichmentStatus === "SKIPPED_CAP");
  assert.deepEqual(skipped.map((w) => w.id), ["cand_d"], "only the candidate whose draw was refused is marked");
  assert.equal("lastSyncedAt" in skipped[0], false, "an unattempted candidate must not look freshly synced");
  assert.equal(h.candidateWrites().some((w) => w.id === "cand_e"), false, "candidates after the refusal are untouched");
  assert.equal(h.run()?.status, "ABORTED_CAP");
  assert.equal(h.run()?.creditsSpent, 3);
});

test("a ledger that THROWS aborts as an error, not as a cap, with nothing asked of Apollo", async () => {
  h = harness({ candidates: [candidate("a"), candidate("b")] });
  h.ledger.drawError = new Error("connection refused");
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(r.status, "ABORTED_ERROR", "'budget exhausted' would be the wrong story for an unreachable ledger");
  assert.match(r.abortReason ?? "", /ledger/);
  assert.match(r.abortReason ?? "", /connection refused/);
  assert.match(r.abortReason ?? "", /2 candidate\(s\) not attempted/);
  assert.equal(h.reveals().length, 0);
  assert.equal(r.creditsSpent, 0);
  assert.equal(h.ledger.spent, 0);
  assert.equal(h.candidateWrites().length, 0, "nothing was attempted, so nothing is marked");
  assert.equal(h.run()?.status, "ABORTED_ERROR", "the aborted run is still recorded");
});

// ─── settlement: what stays drawn and what comes back ───────────────────────

test("a reveal that THROWS keeps the credit in the ledger — Apollo may have billed", async () => {
  const local = harness({ candidates: [candidate("bad")] });
  local.deps.reveal = async () => { throw new Error("timeout"); };
  const r = await runEnrichment({ maxCredits: 10 }, local.deps);
  assert.equal(local.ledger.spent, 1);
  assert.equal(local.ledger.refunds, 0, "an unknowable charge is never refunded");
  assert.equal(r.creditsSpent, 1);
  assert.equal(r.creditsRefunded, 0);
});

test("a clean no-match (null) is the documented free outcome — its credit is refunded", async () => {
  h = harness({ candidates: [candidate("ghost")], reveal: null });
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(h.ledger.draws, 1, "the draw still preceded the call");
  assert.equal(h.ledger.refunds, 1);
  assert.equal(h.ledger.spent, 0);
  assert.equal(r.creditsSpent, 0, "net drawn is zero");
  assert.equal(r.creditsRefunded, 1);
  assert.equal(r.emptyCount, 1);
  assert.equal(h.candidateWrites()[0]?.enrichmentStatus, "UNREACHABLE");
});

test("a match with no email and no phone KEEPS the credit — Apollo bills the match", async () => {
  h = harness({ candidates: [candidate("quiet")], reveal: { email: null, phone: null, dncStatus: null, phoneType: null } });
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(h.ledger.spent, 1);
  assert.equal(h.ledger.refunds, 0);
  assert.equal(r.creditsSpent, 1);
  assert.equal(r.creditsRefunded, 0);
  assert.equal(r.emptyCount, 1);
});

test("a refund dependency that THROWS leaves the credit counted, and the run still completes", async () => {
  // Contract of the injected dependency only. The wired refundCredits never
  // throws — it swallows its own database error and its guarded updateMany can
  // match zero rows silently — so a refund the real ledger rejected is NOT
  // visible to the job and the run row then under-reports the ledger by one.
  // That limit is reported on the batch, not papered over here.
  h = harness({ candidates: [candidate("ghost")], reveal: null });
  h.ledger.refundError = new Error("ledger unavailable");
  const r = await runEnrichment({ maxCredits: 10 }, h.deps);
  assert.equal(r.status, "COMPLETED", "a failed refund is not a failed run");
  assert.equal(h.ledger.spent, 1);
  assert.equal(r.creditsSpent, 1, "a refund that did not happen is not subtracted");
  assert.equal(r.creditsDrawn, 1);
  assert.equal(r.creditsRefunded, 0);
});

// ─── the cap bounds DRAWS, not the net ──────────────────────────────────────

test("a run of clean no-matches still stops AT the cap — a refund never buys another call", async () => {
  // Found in review: gating the cap on the net would let 400 free no-matches
  // make 400 paid calls inside one request, and a function killed mid-loop
  // never writes its run row. maxCredits bounds credits put at risk.
  h = harness({ candidates: ["a", "b", "c"].map((id) => candidate(id)), reveal: null });
  const r = await runEnrichment({ maxCredits: 2 }, h.deps);
  assert.equal(r.status, "ABORTED_CAP");
  assert.deepEqual(h.reveals(), ["a", "b"], "exactly cap calls, even though every one was refunded");
  assert.equal(r.creditsDrawn, 2);
  assert.equal(r.creditsRefunded, 2);
  assert.equal(r.creditsSpent, 0, "net is zero — nothing was ultimately billed");
  assert.equal(h.ledger.spent, 0);
  assert.match(r.abortReason ?? "", /2 credit\(s\) drawn/);
  assert.match(r.abortReason ?? "", /1 candidate\(s\) not attempted/);
  assert.equal(h.run()?.status, "ABORTED_CAP", "the run row is written — the loop did not run away");
});

// ─── the invariant: creditsSpent reconciles against the ledger ─────────────

test("creditsSpent equals NET drawn across a mixed run, and the run record carries the same number", async () => {
  const local = harness({ candidates: ["ok1", "ghost", "boom", "quiet", "ok2"].map((id) => candidate(id)) });
  local.deps.reveal = async (personId: string) => {
    if (personId === "ghost") return null; // free → refunded
    if (personId === "boom") throw new Error("503"); // unknowable → kept
    if (personId === "quiet") return { email: null, phone: null, dncStatus: null, phoneType: null }; // billed → kept
    return { email: `${personId}@dealer.invalid`, phone: null, dncStatus: "not_found", phoneType: null };
  };
  const r = await runEnrichment({ maxCredits: 10 }, local.deps);
  assert.equal(r.status, "COMPLETED");
  assert.equal(local.ledger.draws, 5);
  assert.equal(local.ledger.refunds, 1);
  assert.equal(local.ledger.spent, 4);
  assert.equal(r.creditsDrawn, 5, "gross: one draw per paid call");
  assert.equal(r.creditsSpent, 4, "net drawn: 5 draws − 1 refund");
  assert.equal(r.creditsRefunded, 1);
  assert.equal(r.creditsDrawn, r.creditsSpent + r.creditsRefunded);
  assert.equal(r.creditsSpent, local.ledger.spent, "the run's number IS the ledger's movement");
  assert.equal(local.run()?.creditsSpent, 4, "apollo_enrichment_runs reconciles against ApolloCreditLedger");
  assert.equal(r.enrichedCount, 2);
  assert.equal(r.emptyCount, 2);
  assert.equal(r.failedCount, 1);
});

test("two sequential runs in one cycle cannot exceed the ledger cap between them", async () => {
  // Both runs are quoted the same stale balance (100 000) and ask for 4 each;
  // the ledger holds 5. Before this batch each run would have spent 4.
  const ledger = fakeLedger(5);
  const first = harness({ candidates: ["a", "b", "c", "d"].map((id) => candidate(id)), ledger });
  const second = harness({ candidates: ["e", "f", "g", "h"].map((id) => candidate(id)), ledger });

  const r1 = await runEnrichment({ maxCredits: 4 }, first.deps);
  assert.equal(r1.status, "COMPLETED");
  assert.equal(r1.creditsSpent, 4);

  const r2 = await runEnrichment({ maxCredits: 4 }, second.deps);
  assert.equal(r2.status, "ABORTED_CAP");
  assert.equal(r2.creditsSpent, 1);
  assert.deepEqual(second.reveals(), ["e"]);
  assert.equal(ledger.spent, 5, "the cycle cap holds across runs");
  assert.equal(r1.creditsSpent + r2.creditsSpent, ledger.spent);
});

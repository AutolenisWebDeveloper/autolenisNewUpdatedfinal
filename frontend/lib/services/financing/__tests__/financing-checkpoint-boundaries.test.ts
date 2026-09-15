// §Stage 12 — the boundaries the checkpoint writer did not have, and the failures it swallowed.
//
// Run with:  npx tsx --test lib/services/financing/__tests__/financing-checkpoint-boundaries.test.ts
//
// SIX FINDINGS, ONE FILE, AND THEY SHARE A SHAPE: every one of them is a value the function had
// already read, or a result it had already been handed, and then did not use.
//
//   • the Deal's `status` was SELECTED and never consulted, so a checkpoint could be recorded
//     against a cancelled, refunded or completed deal;
//   • `recordBuyerFinancingPath` selected the same field and ignored it the same way;
//   • the §12b transition was validated against a read taken OUTSIDE the transaction and then
//     written with a blind upsert, so two admins racing both passed the check and the later one
//     silently overwrote the other's lender terms;
//   • the external pre-approval was attached by id alone, unscoped to the deal's buyer, and the
//     `updateMany` count was discarded — so naming another buyer's unattached approval attached
//     it, and naming nothing at all still reported §12c evidence recorded;
//   • the §13-D19 audit chain append was `.catch(log)` and the caller was told the checkpoint
//     succeeded either way — the chain is AUTHORITATIVE, so a lost append is a checkpoint with no
//     record of itself;
//   • the §26 exception on FAILED/EXPIRED was `.catch(() => undefined)`, which is the swallowed
//     terminal call this programme has spent five phases removing.
//
// The two guards are pure and tested directly. The four structural properties are asserted
// against the source, in the idiom this repository already uses for rules that hold until someone
// edits one line: the recording path itself needs a database, and the Playwright journey has one.

import test from "node:test";
import assert from "node:assert/strict";
import { DealStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import {
  FINANCING_CLOSED_DEAL_STATUSES,
  assertDealAcceptsFinancing,
  FinancingCheckpointError,
} from "../financing-checkpoint.service";

// ─────────────────────────────────────────────────────────────────────────────
// The deal-status boundary
// ─────────────────────────────────────────────────────────────────────────────

test("a cancelled, refunded or completed deal takes no financing checkpoint", () => {
  for (const status of [DealStatus.CANCELLED, DealStatus.REFUNDED, DealStatus.COMPLETED]) {
    assert.ok(
      FINANCING_CLOSED_DEAL_STATUSES.includes(status),
      `${status} is terminal — a financing checkpoint against it records money on a dead deal`,
    );
    assert.throws(
      () => assertDealAcceptsFinancing(status),
      (err: unknown) =>
        err instanceof FinancingCheckpointError && err.code === "DEAL_CLOSED",
      `${status} must be refused with a named code, not written`,
    );
  }
});

test("the boundary is a DENYLIST — Phase 8's second checkpoint is not locked out by it", () => {
  // §12a has two checkpoints and `deal-early/D3` gives the second to Phase 8, "after signing,
  // before vehicle release". An allowlist pinned to FINANCING_PENDING would refuse it, and refusing
  // a later phase's legitimate write is the same class of defect as allowing a dead one.
  for (const status of [
    DealStatus.RECAP_PENDING,
    DealStatus.FINANCING_PENDING,
    DealStatus.FEE_PENDING,
    DealStatus.CONTRACT_PENDING,
    DealStatus.SIGNING_PENDING,
    DealStatus.SIGNED,
    DealStatus.FUNDING_PENDING,
  ]) {
    assert.doesNotThrow(() => assertDealAcceptsFinancing(status), `${status} is a live deal`);
  }
});

test("every terminal DealStatus is named — a new one cannot be silently accepted", () => {
  // The three named here are the deal's own end states. If a future phase adds another, this fails
  // and somebody decides, rather than a checkpoint quietly landing on it.
  assert.deepEqual([...FINANCING_CLOSED_DEAL_STATUSES].sort(), ["CANCELLED", "COMPLETED", "REFUNDED"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// The four structural properties
// ─────────────────────────────────────────────────────────────────────────────

const RAW = readFileSync(`${process.cwd()}/lib/services/financing/financing-checkpoint.service.ts`, "utf8");

/**
 * Line comments are stripped before any of the scans below. This file's fixes are DESCRIBED in the
 * comments they replaced — a scanner that matched the prose would fail on the explanation of the
 * defect it exists to forbid, which is a scanner asserting about documentation.
 */
const SRC = RAW.split("\n")
  .map((line) => (line.trimStart().startsWith("//") ? "" : line))
  .join("\n");

function body(name: string): string {
  const start = SRC.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = SRC.indexOf("\nexport ", start + 10);
  return SRC.slice(start, next > 0 ? next : SRC.length);
}

test("both writers consult the deal status they read", () => {
  for (const name of ["recordFinancingCheckpoint", "recordBuyerFinancingPath"]) {
    assert.match(
      body(name),
      /assertDealAcceptsFinancing\(/,
      `${name} selects the deal's status — reading it and not using it is how it got here`,
    );
  }
});

test("the financing row is written under a compare-and-swap, not a blind upsert", () => {
  const fn = body("recordFinancingCheckpoint");
  assert.equal(
    /tx\.financing\.upsert\(/.test(fn),
    false,
    "an upsert cannot express 'only if the status is still what I validated against'",
  );
  assert.match(fn, /status: existing\.status/, "the update must pin the status the transition was checked against");
  assert.match(fn, /CONCURRENT_MODIFICATION/, "and a lost race must be refused, not silently applied");
});

test("the §12b transition is validated inside the transaction that writes it", () => {
  const fn = body("recordFinancingCheckpoint");
  const txAt = fn.indexOf("prisma.$transaction");
  const checkAt = fn.indexOf("INVALID_TRANSITION");
  assert.ok(txAt > 0 && checkAt > txAt, "a check against a read taken before the transaction proves nothing");
});

test("the external pre-approval is scoped to this deal's buyer and its count is checked", () => {
  const fn = body("recordFinancingCheckpoint");
  // NARROWED TO THE `where` CLAUSE ON PURPOSE. Scanning the whole function for `buyerId:
  // deal.buyerId` passed on the UNFIXED code, because the audit payload thirty lines below carries
  // the same pair — a vacuous assertion, which is the defect class this whole batch is about.
  const at = fn.indexOf("externalPreApproval.updateMany(");
  assert.ok(at > 0, "the attach is still an updateMany");
  const call = fn.slice(at, fn.indexOf("data:", at));
  assert.match(call, /buyerId: deal\.buyerId/, "an id alone can name another buyer's approval");
  assert.match(
    fn,
    /EVIDENCE_NOT_ATTACHABLE/,
    "a zero-row updateMany must not report §12c evidence as recorded",
  );
});

test("the audit-chain append tells the caller whether it landed", () => {
  const fn = body("recordFinancingCheckpoint");
  assert.match(fn, /auditRecorded/, "§13-D19 makes the chain authoritative; a lost append cannot read as success");
  assert.match(
    fn,
    /FINANCING_AUDIT_APPEND_FAILED/,
    "and it must leave a durable row, not only a log line nobody queries",
  );
});

test("no terminal call in this file is swallowed", () => {
  assert.equal(
    /\.catch\(\(\) => undefined\)/.test(SRC),
    false,
    "a guarded terminal call logs; a swallowed one is indistinguishable from one that never ran",
  );
});

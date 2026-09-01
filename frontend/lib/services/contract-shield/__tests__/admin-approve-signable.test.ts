// Admin Contract Shield APPROVE must leave the deal genuinely SIGNABLE, and must
// approve the EXACT document the admin reviewed.
//
// Defect 1 (pinned by the first block): on a WARNING/FAIL scan the backing
// ContractVersion is set to REJECTED (dealer-contract.service, fail-closed —
// correct). The admin APPROVE override then set ContractScan=PASS, force-advanced
// the Deal to CONTRACT_APPROVED, and told the buyer "you can review and sign it
// now" — but never flipped the ContractVersion out of REJECTED.
// prepareBuyerSigningEnvelope requires a ContractVersion with status APPROVED, so
// it threw NoSignableDocumentError, the route swallowed it with .catch(), and the
// buyer was sent to a signing page that could never produce a document. The deal
// dead-ended at CONTRACT_APPROVED.
//
// Defect 2 (pinned by the "binds to the reviewed version" block): ContractScan had
// no link to the ContractVersion it judged — the verdict and the judged document
// were associated only through the one-to-many dealId. The override therefore
// approved `orderBy: { version: "desc" }, take: 1` — whatever version happened to
// be NEWEST at click time, not the one the admin read. A dealer uploading a
// revision while the scan sat in the review queue got that unreviewed revision
// APPROVED, and buyer-signing.service binds the buyer's signature and tamper hash
// to whichever version is APPROVED. That failed OPEN: a binding signature on a
// document Contract Shield had never passed.
//
// The fix binds approval to the scan's own contractVersionId and refuses (rather
// than guessing) when the link is missing or a newer version has landed since the
// scan. ContractVersion is owned by dealer-contract.service, so the override lives
// there (approveContractVersionByAdmin) rather than being re-implemented in the route.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/contract-shield/__tests__/admin-approve-signable.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface CV { id: string; dealId: string; version: number; status: string; rejectionReason: string | null }

let versions: CV[] = [];
let updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      contractVersion: {
        findMany: async ({ where, orderBy, take }: { where: { dealId: string }; orderBy?: unknown; take?: number }) => {
          void orderBy;
          const rows = versions.filter((v) => v.dealId === where.dealId).sort((a, b) => b.version - a.version);
          return take ? rows.slice(0, take) : rows;
        },
        findUnique: async ({ where }: { where: { id: string } }) => versions.find((v) => v.id === where.id) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `cv_${versions.length + 1}`, rejectionReason: null, ...(data as object) } as unknown as CV;
          versions.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ where, data });
          const v = versions.find((x) => x.id === where.id);
          if (v) Object.assign(v, data);
          return v;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          updates.push({ where, data });
          let n = 0;
          for (const v of versions) {
            if (v.dealId === where.dealId && (where.status === undefined || v.status === where.status)) {
              if (where.id && typeof where.id === "object" && "not" in (where.id as object)) {
                if (v.id === (where.id as { not: string }).not) continue;
              }
              Object.assign(v, data);
              n++;
            }
          }
          return { count: n };
        },
      },
      deal: {
        findFirst: async () => ({ id: "deal_1" }),
        findUnique: async ({ where }: { where: { id: string } }) => (where.id === "deal_1" ? { id: "deal_1" } : null),
      },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });
mock.module("@/lib/services/contract-shield/contract-shield.service", { namedExports: { scanContract: async () => ({ status: "PASS", score: 90, fixList: [] }) } });
mock.module("@/lib/services/contract-shield/extract-text", { namedExports: { extractContractText: async () => "text" } });

async function load() { return import("@/lib/services/dealer/dealer-contract.service"); }

beforeEach(() => {
  versions = [{ id: "cv_1", dealId: "deal_1", version: 1, status: "REJECTED", rejectionReason: "Contract Shield FAIL (score 40)." }];
  updates = [];
});

test("admin approval flips the REJECTED contract version to APPROVED so signing can proceed", async () => {
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", "cv_1");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.contractVersionId, "cv_1");
  assert.equal(versions[0]!.status, "APPROVED", "prepareBuyerSigningEnvelope requires an APPROVED version");
  assert.equal(versions[0]!.rejectionReason, null, "the stale rejection reason must be cleared");
});

test("approving supersedes any other APPROVED version — exactly one stays approved", async () => {
  versions = [
    { id: "cv_1", dealId: "deal_1", version: 1, status: "APPROVED", rejectionReason: null },
    { id: "cv_2", dealId: "deal_1", version: 2, status: "REJECTED", rejectionReason: "FAIL" },
  ];
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", "cv_2");
  assert.equal(result.ok && result.contractVersionId, "cv_2", "the REVIEWED version is the one being approved");
  const approved = versions.filter((v) => v.status === "APPROVED").map((v) => v.id);
  assert.deepEqual(approved, ["cv_2"], "the older version must be superseded, not left approved alongside");
});

test("already-approved reviewed version is a safe no-op (idempotent)", async () => {
  versions = [{ id: "cv_1", dealId: "deal_1", version: 1, status: "APPROVED", rejectionReason: null }];
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", "cv_1");
  assert.equal(result.ok && result.contractVersionId, "cv_1");
  assert.equal(versions[0]!.status, "APPROVED");
});

// ── The compliance gate: approval binds to the reviewed version ──────────────
// Requirement (1): approval of a superseded/unreviewed version is REJECTED.
// Requirement (2): approval binds to the EXACT version the reviewed scan targeted.

test("REFUSES when a newer version was uploaded after the reviewed scan (upload-during-review race)", async () => {
  // The admin reviewed the scan of v1. While it sat in the queue the dealer
  // uploaded v2, which Contract Shield has NOT passed. Approving must refuse:
  // approving v1 would sign a superseded document, and approving v2 would sign
  // one nobody reviewed.
  versions = [
    { id: "cv_1", dealId: "deal_1", version: 1, status: "REJECTED", rejectionReason: "Contract Shield FAIL (score 40)." },
    { id: "cv_2", dealId: "deal_1", version: 2, status: "UPLOADED", rejectionReason: null },
  ];
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", "cv_1");

  assert.equal(result.ok, false, "a stale review must not approve anything");
  assert.equal(result.ok === false && result.code, "SUPERSEDED_BY_NEWER_UPLOAD");
  assert.deepEqual(
    versions.filter((v) => v.status === "APPROVED").map((v) => v.id),
    [],
    "neither the stale reviewed version nor the unreviewed newer version may be approved",
  );
  assert.deepEqual(updates, [], "a refused approval writes nothing at all");
});

test("NEVER approves the newest version when the scan reviewed an older one", async () => {
  // The exact production exploit: the reviewed scan targeted cv_1, but the old
  // implementation took `orderBy: { version: "desc" }, take: 1` and approved
  // cv_2 — a document the admin never saw and Contract Shield never passed.
  versions = [
    { id: "cv_1", dealId: "deal_1", version: 1, status: "REJECTED", rejectionReason: "reviewed" },
    { id: "cv_2", dealId: "deal_1", version: 2, status: "REJECTED", rejectionReason: "never reviewed" },
  ];
  const { approveContractVersionByAdmin } = await load();
  await approveContractVersionByAdmin("deal_1", "cv_1");
  assert.equal(versions.find((v) => v.id === "cv_2")!.status, "REJECTED", "the unreviewed newest version must never be approved");
});

test("HARD REFUSES a legacy scan with no linked contract version — no heuristic fallback", async () => {
  // Pre-migration ContractScan rows carry no contractVersionId. Guessing (e.g.
  // "approve the latest") is what produced the defect, so the gate fails closed:
  // the admin must re-scan to produce a linked verdict.
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", null);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "NO_LINKED_VERSION");
  assert.equal(versions[0]!.status, "REJECTED", "the un-linked deal's version must be left untouched");
  assert.deepEqual(updates, [], "a refused approval writes nothing at all");
});

test("REFUSES when the linked version no longer exists", async () => {
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", "cv_deleted");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "VERSION_NOT_FOUND");
  assert.deepEqual(updates, [], "a refused approval writes nothing at all");
});

test("REFUSES a contract version belonging to a different deal", async () => {
  versions = [
    { id: "cv_1", dealId: "deal_1", version: 1, status: "REJECTED", rejectionReason: null },
    { id: "cv_other", dealId: "deal_2", version: 1, status: "REJECTED", rejectionReason: null },
  ];
  const { approveContractVersionByAdmin } = await load();
  const result = await approveContractVersionByAdmin("deal_1", "cv_other");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "VERSION_NOT_FOUND");
  assert.equal(versions.find((v) => v.id === "cv_other")!.status, "REJECTED", "another deal's contract must never be approved");
});

// ── Concierge track reachability ────────────────────────────────────────────
// assertDealerOwnsDeal gates on offer.dealerId, which is null for every concierge
// deal — so the ONLY writer of ContractVersion was unreachable for that track, and
// without a ContractVersion the deal could never be scanned, approved, signed or
// completed. The admin path reuses the SAME pipeline rather than a parallel one.

test("an admin can attach a contract to a dealer-less (concierge) deal", async () => {
  versions = [];
  const { uploadContractForDealByAdmin } = await load();
  const cv = await uploadContractForDealByAdmin("deal_1", "https://x/c.pdf", "admin_1");
  assert.equal(cv.dealId, "deal_1");
  assert.equal(cv.version, 1);
  assert.equal(cv.status, "UPLOADED", "must enter the normal fail-closed scan pipeline, not pre-approved");
  assert.equal(cv.uploadedBy, "admin_1", "provenance records the admin, not a fake dealer id");
});

test("the admin path versions and supersedes exactly like the dealer path", async () => {
  versions = [{ id: "cv_1", dealId: "deal_1", version: 1, status: "APPROVED", rejectionReason: null }];
  const { uploadContractForDealByAdmin } = await load();
  const cv = await uploadContractForDealByAdmin("deal_1", "https://x/c2.pdf", "admin_1");
  assert.equal(cv.version, 2, "version increments");
  assert.equal(versions.find((v) => v.id === "cv_1")!.status, "SUPERSEDED", "the prior approved version is superseded");
});

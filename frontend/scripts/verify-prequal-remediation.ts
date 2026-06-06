// Standalone behavioral check for the P0 prequal remediations.
// Run with: pnpm tsx scripts/verify-prequal-remediation.ts
//
// Exercises the actual exported functions — no test framework, no DB writes.
//
//   D-I (gating)      → isPrequalValid() with every decision/expiry combination
//   D-J (misconfig)   → callIPredict() with placeholder creds + with sandbox=true
//   D-A (stale)       → source assertion: cron contains no `update` call
//   D-H (OFAC SLA)    → source assertion: query matches OFAC_REVIEW + 24h SLA

import { readFileSync } from "fs";
import { join } from "path";
import { isPrequalValid } from "../lib/services/prequal/prequal.service";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
const past   = new Date(Date.now() - 24 * 60 * 60 * 1000);

console.log("D-I  isPrequalValid() gating:");
check("null prequal → false",                            isPrequalValid(null) === false);
check("APPROVED + future expiresAt → true",              isPrequalValid({ decision: "APPROVED", expiresAt: future }) === true);
check("APPROVED + past   expiresAt → false (expired)",   isPrequalValid({ decision: "APPROVED", expiresAt: past }) === false);
check("DECLINED + future expiresAt → false",             isPrequalValid({ decision: "DECLINED", expiresAt: future }) === false);
check("PENDING + future expiresAt → false",              isPrequalValid({ decision: "PENDING", expiresAt: future }) === false);
check("MANUAL_REVIEW + future expiresAt → false",        isPrequalValid({ decision: "MANUAL_REVIEW", expiresAt: future }) === false);
check("OFAC_REVIEW + future expiresAt → false",          isPrequalValid({ decision: "OFAC_REVIEW", expiresAt: future }) === false);
check("OFAC_ESCALATED + future expiresAt → false",       isPrequalValid({ decision: "OFAC_ESCALATED", expiresAt: future }) === false);

console.log("\nD-J  callIPredict() configuration safety:");
// Misconfig: sandbox unset, placeholder creds → MANUAL_REVIEW (CONFIG_ERROR).
delete process.env.MICROBILT_SANDBOX;
process.env.MICROBILT_CLIENT_ID = "placeholder-client-id";
process.env.IPREDICT_GET_REPORT_URL = "https://example.invalid/report";
process.env.PREQUAL_ENCRYPTION_KEY = "0".repeat(64);

const { callIPredict } = await import("../lib/services/prequal/microbilt.service");

const misconfig = await callIPredict({
  buyer: { firstName: "X", lastName: "Y", dateOfBirth: "01/01/1990",
           address: "1 A", city: "B", state: "CA", zip: "90001" },
  monthlyIncomeCents:  null,
  employmentStatus:    null,
  lengthOfEmployment:  null,
  statedBudgetCents:   null,
});
check("misconfig → decision MANUAL_REVIEW",          misconfig.decision === "MANUAL_REVIEW", `got ${misconfig.decision}`);
check("misconfig → reason CONFIG_ERROR",             misconfig.reason === "CONFIG_ERROR", `got ${misconfig.reason}`);
check("misconfig → mocked === false (no fake APPR)", misconfig.mocked === false);
check("misconfig → ofacFlagged is null (indeterm.)", misconfig.ofacFlagged === null);

// Sandbox bypass: MICROBILT_SANDBOX=true → APPROVED immediately.
process.env.MICROBILT_SANDBOX = "true";
const sandboxed = await callIPredict({
  buyer: { firstName: "X", lastName: "Y", dateOfBirth: "01/01/1990",
           address: "1 A", city: "B", state: "CA", zip: "90001" },
  monthlyIncomeCents:  null,
  employmentStatus:    null,
  lengthOfEmployment:  null,
  statedBudgetCents:   null,
});
check("sandbox=true → decision APPROVED",            sandboxed.decision === "APPROVED");
check("sandbox=true → mocked === true",              sandboxed.mocked === true);
check("sandbox=true → ofacFlagged === false",        sandboxed.ofacFlagged === false);

console.log("\nD-A  stale-cleanup source assertions:");
const stale = readFileSync(join(__dirname, "..", "app/api/cron/prequal-stale-cleanup/route.ts"), "utf8");
check("no `updateMany` in stale-cleanup",            !stale.includes("updateMany"));
check("no `data:` mutation in stale-cleanup",        !/data:\s*{[^}]*decision/.test(stale));
check("counts via prisma.preQualification.count",    stale.includes("preQualification.count"));

console.log("\nD-H  prequal-sla-escalation source assertions:");
const sla = readFileSync(join(__dirname, "..", "app/api/cron/prequal-sla-escalation/route.ts"), "utf8");
check("query includes OFAC_REVIEW",                  sla.includes('"OFAC_REVIEW"'));
check("query includes OFAC_ESCALATED",               sla.includes('"OFAC_ESCALATED"'));
check("query filters on checkOfacAlert: true",       /checkOfacAlert:\s*true/.test(sla));
check("query filters on updatedAt: { lt:",           /updatedAt:\s*{\s*lt:/.test(sla));
check("24h SLA constant present",                    sla.includes("OFAC_SLA_HOURS = 24"));

console.log("\nD-A  buyer expired-state surface:");
const buyerPrequalPage = readFileSync(join(__dirname, "..", "app/buyer/prequal/page.tsx"), "utf8");
// Expired APPROVED takes the form path because prequalApproved check fails;
// the renew banner appears when expiresAt <= now (regardless of decision).
check("renew banner triggers on expiresAt <= now",   /expiresAt\s*<=\s*now/.test(buyerPrequalPage));
check("expired path does not check decision",        /prequal\.expiresAt\s*&&\s*prequal\.expiresAt\s*<=\s*now/.test(buyerPrequalPage));

// ── Patch the Resend SDK BEFORE the email service is imported ────────────────
// The email service does `import { Resend } from "resend"` once at module
// load. Replacing the class on the SDK module here means every `new Resend()`
// inside the service yields our stub, so we can drive SENT / FAILED outcomes
// deterministically. tsx evaluates these top-level awaits in order, and the
// email service is dynamically imported below — so by the time it grabs the
// `Resend` symbol, our stub is already in place.
// The Resend SDK uses `fetch` under the hood and swallows network errors into
// `{ data: null, error: {...} }`. We patch `globalThis.fetch` so we can drive
// SUCCEED / SDK_ERROR outcomes deterministically without monkey-patching the
// (read-only ESM) resend module export.
let sendScenario: "SUCCEED" | "SDK_ERROR" = "SUCCEED";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const target = typeof url === "string" ? url : (url as URL).toString();
  if (target.includes("resend.com") || target.includes("/emails")) {
    if (sendScenario === "SDK_ERROR") {
      return new Response(
        JSON.stringify({ name: "application_error", message: "Resend API outage" }),
        { status: 500, statusText: "Internal Server Error" },
      );
    }
    return new Response(
      JSON.stringify({ id: `re-${Date.now()}-${Math.random()}` }),
      { status: 200, statusText: "OK" },
    );
  }
  return realFetch(url as Request, init);
}) as typeof fetch;

// ── FCRA adverse-action idempotency (per-decision key) ───────────────────────
// Stub prisma.emailSendLog so we can observe the idempotency keys handed to
// sendIdempotent() without touching a real DB. Each invocation returns null
// by default (i.e. "no prior send") and records the key; flip
// `simulateDuplicate` to force the DUPLICATE outcome.
console.log("\nFCRA  adverse-action / under-review per-decision idempotency:");
const { prisma } = await import("../lib/prisma");
const capturedKeys: string[] = [];
let simulateDuplicate = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).emailSendLog = {
  findUnique: async ({ where }: { where: { idempotencyKey: string } }) => {
    capturedKeys.push(where.idempotencyKey);
    // Duplicate suppression only fires for a VERIFIED prior send (status SENT);
    // a prior FAILED/DEV_SKIPPED row is retryable, matching sendIdempotent.
    return simulateDuplicate ? { status: "SENT", resendId: "prior-id" } : null;
  },
  // sendIdempotent upserts the attempt row (retry-safe) rather than create().
  upsert: async () => ({}),
  create: async () => ({}),
};
// Per-decision tests run under placeholder key (DEV_SKIPPED dispatch path);
// outcome tests later toggle to a real-looking key + the Resend stub.
process.env.RESEND_API_KEY = "placeholder";

const { sendAdverseActionEmail, sendPrequalUnderReviewEmail, sendPrequalApprovedEmail } = await import(
  "../lib/services/email/resend.service"
);

const prequalId = "PRQ-stable-id-123";
const firstDecisionTs  = "2026-05-10T10:00:00.000Z";
const secondDecisionTs = "2026-05-12T14:30:00.000Z";

// Two distinct declines for the SAME prequal id must produce DIFFERENT keys.
capturedKeys.length = 0;
await sendAdverseActionEmail({
  to: "buyer@example.com", firstName: "B", decisionDate: "May 10, 2026",
  prequalApplicationId: prequalId, decisionTimestamp: firstDecisionTs,
});
await sendAdverseActionEmail({
  to: "buyer@example.com", firstName: "B", decisionDate: "May 12, 2026",
  prequalApplicationId: prequalId, decisionTimestamp: secondDecisionTs,
});
check(
  "two adverse-action sends, same id + different timestamps → different keys",
  capturedKeys.length === 2 && capturedKeys[0] !== capturedKeys[1],
  `keys=[${capturedKeys.join(", ")}]`,
);
check(
  "adverse-action key includes prequal id + decisionTimestamp",
  capturedKeys[0] === `adverse-action-${prequalId}-${firstDecisionTs}` &&
  capturedKeys[1] === `adverse-action-${prequalId}-${secondDecisionTs}`,
);

// Genuine intra-request double-send (same id, same timestamp) must still collapse.
capturedKeys.length = 0;
await sendAdverseActionEmail({
  to: "buyer@example.com", firstName: "B", decisionDate: "May 10, 2026",
  prequalApplicationId: prequalId, decisionTimestamp: firstDecisionTs,
});
await sendAdverseActionEmail({
  to: "buyer@example.com", firstName: "B", decisionDate: "May 10, 2026",
  prequalApplicationId: prequalId, decisionTimestamp: firstDecisionTs,
});
check(
  "adverse-action: same id + same timestamp → same key (double-send still de-dupes)",
  capturedKeys.length === 2 && capturedKeys[0] === capturedKeys[1],
);

// Under-review notice — identical contract.
capturedKeys.length = 0;
await sendPrequalUnderReviewEmail({
  to: "buyer@example.com", firstName: "B",
  prequalApplicationId: prequalId, decisionTimestamp: firstDecisionTs,
});
await sendPrequalUnderReviewEmail({
  to: "buyer@example.com", firstName: "B",
  prequalApplicationId: prequalId, decisionTimestamp: secondDecisionTs,
});
check(
  "two under-review sends, same id + different timestamps → different keys",
  capturedKeys.length === 2 && capturedKeys[0] !== capturedKeys[1],
  `keys=[${capturedKeys.join(", ")}]`,
);
check(
  "under-review key includes prequal id + decisionTimestamp",
  capturedKeys[0] === `prequal-under-review-${prequalId}-${firstDecisionTs}` &&
  capturedKeys[1] === `prequal-under-review-${prequalId}-${secondDecisionTs}`,
);
capturedKeys.length = 0;
await sendPrequalUnderReviewEmail({
  to: "buyer@example.com", firstName: "B",
  prequalApplicationId: prequalId, decisionTimestamp: firstDecisionTs,
});
await sendPrequalUnderReviewEmail({
  to: "buyer@example.com", firstName: "B",
  prequalApplicationId: prequalId, decisionTimestamp: firstDecisionTs,
});
check(
  "under-review: same id + same timestamp → same key (double-send still de-dupes)",
  capturedKeys.length === 2 && capturedKeys[0] === capturedKeys[1],
);

// ── Admin resend endpoint must always dispatch ──────────────────────────────
// Two consecutive resends of the same unchanged prequal must produce DIFFERENT
// idempotency keys — the resend is the admin's explicit override of the
// idempotency layer, not a re-decision. We simulate the resend route's exact
// key-construction logic.
console.log("\nADMIN  resend endpoint per-click idempotency:");
function resendKey(kind: "APPROVED" | "ADVERSE_ACTION", prequalId: string, stamp: Date) {
  return kind === "APPROVED"
    ? `prequal-approved-resend-${prequalId}-${stamp.toISOString()}`
    : `adverse-action-resend-${prequalId}-${stamp.toISOString()}`;
}

// Source-level assertion — the resend route must build its own per-click key
// and pass it as `idempotencyKey` to BOTH email functions.
const resendRoute = readFileSync(
  join(__dirname, "..", "app/api/admin/buyers/[buyerId]/prequal/resend-email/route.ts"),
  "utf8",
);
check("resend route builds resend-moment idempotency key",
  /idempotencyKey:\s*resendIdempotencyKey/.test(resendRoute) &&
  /prequal-approved-resend-.*stamp\.toISOString/.test(resendRoute) &&
  /adverse-action-resend-.*stamp\.toISOString/.test(resendRoute));

// End-to-end key capture via the email functions' new idempotencyKey override.
for (const kind of ["APPROVED", "ADVERSE_ACTION"] as const) {
  capturedKeys.length = 0;
  const firstStamp = new Date("2026-05-18T09:00:00.000Z");
  const secondStamp = new Date("2026-05-18T09:00:00.500Z"); // 500ms later
  const k1 = resendKey(kind, prequalId, firstStamp);
  const k2 = resendKey(kind, prequalId, secondStamp);

  if (kind === "APPROVED") {
    await sendPrequalApprovedEmail({
      to: "buyer@example.com", firstName: "B",
      maxOtdAmountCents: 3500000, tier: "GOOD",
      decisionDate: firstStamp, expiryDate: new Date(),
      idempotencyKey: k1,
    });
    await sendPrequalApprovedEmail({
      to: "buyer@example.com", firstName: "B",
      maxOtdAmountCents: 3500000, tier: "GOOD",
      decisionDate: secondStamp, expiryDate: new Date(),
      idempotencyKey: k2,
    });
  } else {
    await sendAdverseActionEmail({
      to: "buyer@example.com", firstName: "B",
      decisionDate: "May 18, 2026",
      prequalApplicationId: prequalId,
      idempotencyKey: k1,
    });
    await sendAdverseActionEmail({
      to: "buyer@example.com", firstName: "B",
      decisionDate: "May 18, 2026",
      prequalApplicationId: prequalId,
      idempotencyKey: k2,
    });
  }
  check(
    `${kind} resend: two clicks → different keys (both dispatch)`,
    capturedKeys.length === 2 && capturedKeys[0] !== capturedKeys[1] &&
    capturedKeys[0] === k1 && capturedKeys[1] === k2,
    `keys=[${capturedKeys.join(", ")}]`,
  );
}

// Resend key must NOT collide with the original decision-time key.
const declineKey = `adverse-action-${prequalId}-${firstDecisionTs}`;
const resendK   = `adverse-action-resend-${prequalId}-${new Date().toISOString()}`;
check("resend key namespace is distinct from decision-time key",
  declineKey !== resendK && !resendK.startsWith(declineKey));

// ── Send-failure audit contract ──────────────────────────────────────────────
// sendIdempotent must expose a discriminated `outcome` so the decline paths
// can tell DUPLICATE / FAILED / DEV_SKIPPED apart — all three return
// `sent === false` and the previous boolean-only contract mislabeled FAILED /
// DEV_SKIPPED as SUPPRESSED_DUPLICATE in the FCRA audit trail.
console.log("\nFCRA  send-failure outcome contract:");

async function sendOnce(scenario: "SENT" | "FAILED" | "DEV_SKIPPED" | "DUPLICATE") {
  simulateDuplicate = scenario === "DUPLICATE";
  // DEV_SKIPPED ← placeholder key → getResend() returns null in the service.
  // SENT / FAILED ← real-looking key → service calls `new Resend(key)` which
  //                  yields our StubResend; sendScenario drives the outcome.
  process.env.RESEND_API_KEY =
    scenario === "DEV_SKIPPED" ? "placeholder" : "re_test_real_key";
  // The patched `fetch` decides the dispatch outcome for FAILED vs SENT.
  // For DEV_SKIPPED the email service never reaches fetch (placeholder key).
  // For DUPLICATE the findUnique stub short-circuits before fetch.
  sendScenario = scenario === "FAILED" ? "SDK_ERROR" : "SUCCEED";

  return sendAdverseActionEmail({
    to: "buyer@example.com",
    firstName: "B",
    decisionDate: "May 18, 2026",
    prequalApplicationId: prequalId,
    // Unique per call so DUPLICATE only fires when simulateDuplicate is on.
    decisionTimestamp: `${new Date().toISOString()}-${scenario}`,
  });
}

const sentResult        = await sendOnce("SENT");
const failedResult      = await sendOnce("FAILED");
const devSkippedResult  = await sendOnce("DEV_SKIPPED");
const duplicateResult   = await sendOnce("DUPLICATE");

check("SENT       → outcome SENT,        sent=true",
  sentResult.outcome === "SENT"        && sentResult.sent === true);
check("FAILED     → outcome FAILED,      sent=false",
  failedResult.outcome === "FAILED"    && failedResult.sent === false);
check("DEV_SKIPPED→ outcome DEV_SKIPPED, sent=false",
  devSkippedResult.outcome === "DEV_SKIPPED" && devSkippedResult.sent === false);
check("DUPLICATE  → outcome DUPLICATE,   sent=false",
  duplicateResult.outcome === "DUPLICATE" && duplicateResult.sent === false);

// Decline-path mapping must match these production lines. Inline mirror:
function mapOutcomeToEventType(o: string): string {
  return o === "SENT"
    ? "ADVERSE_ACTION_NOTICE_SENT"
    : o === "DUPLICATE"
      ? "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE"
      : "ADVERSE_ACTION_NOTICE_SEND_FAILED";
}
check("mapping: SENT  → ADVERSE_ACTION_NOTICE_SENT",
  mapOutcomeToEventType("SENT") === "ADVERSE_ACTION_NOTICE_SENT");
check("mapping: DUPLICATE → ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE",
  mapOutcomeToEventType("DUPLICATE") === "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE");
check("mapping: FAILED → ADVERSE_ACTION_NOTICE_SEND_FAILED (NOT _DUPLICATE)",
  mapOutcomeToEventType("FAILED") === "ADVERSE_ACTION_NOTICE_SEND_FAILED");
check("mapping: DEV_SKIPPED → ADVERSE_ACTION_NOTICE_SEND_FAILED (NOT _DUPLICATE)",
  mapOutcomeToEventType("DEV_SKIPPED") === "ADVERSE_ACTION_NOTICE_SEND_FAILED");
check("mapping: THREW → ADVERSE_ACTION_NOTICE_SEND_FAILED",
  mapOutcomeToEventType("THREW") === "ADVERSE_ACTION_NOTICE_SEND_FAILED");

// All three decline files must implement EXACTLY this branching. A regex
// over the file content asserts the production mapping mirrors our inline
// reference — guards against future drift.
const declinePaths = [
  "lib/services/prequal/prequal.service.ts",
  "lib/services/prequal/admin-prequal.service.ts",
  "app/api/admin/buyers/[buyerId]/prequal/manual-override/route.ts",
];
for (const rel of declinePaths) {
  const src = readFileSync(join(__dirname, "..", rel), "utf8");
  check(`${rel}: branches on outcome === "SENT"`,
    /outcome\s*===\s*"SENT"/.test(src));
  check(`${rel}: branches on outcome === "DUPLICATE"`,
    /outcome\s*===\s*"DUPLICATE"/.test(src));
  check(`${rel}: writes ADVERSE_ACTION_NOTICE_SENT for SENT`,
    /"ADVERSE_ACTION_NOTICE_SENT"/.test(src));
  check(`${rel}: writes ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE for DUPLICATE`,
    /"ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE"/.test(src));
  check(`${rel}: writes ADVERSE_ACTION_NOTICE_SEND_FAILED for all other outcomes`,
    /"ADVERSE_ACTION_NOTICE_SEND_FAILED"/.test(src));
  // Critical: no code path treats `sent === false` as duplicate without
  // checking outcome. The boolean branch from the previous pass must be gone.
  check(`${rel}: no boolean-only "sent ? SENT : DUPLICATE" branch remains`,
    !/\.sent\s*\?\s*"sent"\s*:\s*"duplicate"/.test(src) &&
    !/result\.sent\s*\?\s*"ADVERSE_ACTION_NOTICE_SENT"/.test(src));
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
}
main();

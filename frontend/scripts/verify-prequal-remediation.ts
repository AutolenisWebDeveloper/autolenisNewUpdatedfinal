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

// ── FCRA adverse-action idempotency (per-decision key) ───────────────────────
// Stub prisma.emailSendLog so we can observe the idempotency keys handed to
// sendIdempotent() without touching a real DB. Each invocation returns null
// (i.e. "no prior send"); we ALSO record the keys so we can compare them.
console.log("\nFCRA  adverse-action / under-review per-decision idempotency:");
const { prisma } = await import("../lib/prisma");
const capturedKeys: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).emailSendLog = {
  findUnique: async ({ where }: { where: { idempotencyKey: string } }) => {
    capturedKeys.push(where.idempotencyKey);
    return null;
  },
  create: async () => ({}),
};
// Force the email service to skip its real Resend dispatch — placeholder API key.
process.env.RESEND_API_KEY = "placeholder";

const { sendAdverseActionEmail, sendPrequalUnderReviewEmail } = await import(
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

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
}
main();

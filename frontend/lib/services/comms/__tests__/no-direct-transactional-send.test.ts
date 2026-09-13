// BUILD-FAILING RULE — no direct transactional send outside the dispatcher.
//
// §27: "All transactional email, SMS, and in-app notices dispatch through the
// durable outbox… NO PAGE REQUEST DETERMINES WHETHER A TRANSACTION COMMUNICATION
// SURVIVES." A direct provider call inside a request handler is exactly the thing
// that sentence forbids: it lives and dies with the request, has no retry, no
// idempotency key, no send-time state recheck and no terminal-failure alert.
//
// SCOPE: REPOSITORY-WIDE. §8.2's Phase 2 bullet says "the same tree list as
// Enforcement object 3". Enforcement object 3 HAS no tree list — §8.2 Phase 1
// records that a hand-listed tree set was tried and REJECTED in the second review
// because it "could not see three of the four reference sites its own allowlist
// named". The cross-reference is the error; the corrected design is a repository-
// wide scan with an explicit allowlist, and that is what this rule does. Ruled by
// the owner, 2026-09-07.
//
// THE TOKEN LIST IN §8.2 DOES NOT MATCH THE CODE. It names
// "Resend/Twilio/`sendEmail`/`sendSms`/`sendTransactional*`". There is no function
// called `sendEmail` in `lib/services` — only the workflow node-type STRING
// `'action.sendEmail'` — and nothing matches `sendTransactional*` at all. A rule
// built on those literals would scan clean and enforce nothing. The real surface
// is three things, and this rule matches all three:
//
//   1. a direct SDK import (`from "resend"`, `from "twilio"`);
//   2. a call to a `resend.service` export that lands on `sendIdempotent`;
//   3. a call to a `sendSms` / `sendCrmSms` entry point.
//
// (2) IS DERIVED, NOT HARDCODED. Six of the seven senders inside the transaction
// trees reach Resend INDIRECTLY, through `resend.service`, so a scan for the
// literal "resend" passes all six. Whether a given export is a violation depends on
// which rail its body uses: 70 call `sendIdempotent` (direct) and 5 call
// `enqueueTransactionalEmail` (dispatcher). This test parses `resend.service.ts` at
// run time and classifies every export by rail, so migrating one export to the
// dispatcher automatically reclassifies its callers and the allowlist shrinks
// without anyone editing this file.
//
// Run: pnpm test:comms-outbox

import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { sourceFiles, assertScanned } from "@/lib/testing/source-scan";
import { DIRECT_SEND_ALLOWLIST } from "./direct-send-allowlist";

const ROOT = process.cwd();
const ROOTS = ["app", "lib", "components", "scripts"] as const;
const RESEND_SERVICE = "lib/services/email/resend.service.ts";

type Reason = "resend-sdk" | "twilio-sdk" | "direct-sender" | "sms";

/**
 * Classify every exported sender in `resend.service.ts` by the rail its body uses.
 * Parsed, so a body that merely MENTIONS `sendIdempotent` in a comment does not
 * count, and a renamed helper is a visible failure rather than a silent pass.
 */
function directRailExports(): Set<string> {
  const src = readFileSync(`${ROOT}/${RESEND_SERVICE}`, "utf8");
  const sf = ts.createSourceFile(RESEND_SERVICE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const direct = new Set<string>();
  ts.forEachChild(sf, (n) => {
    if (!ts.isFunctionDeclaration(n) || !n.name) return;
    if (!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;
    if (!n.body) return;
    let usesDirect = false;
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "sendIdempotent") {
        usesDirect = true;
      }
      ts.forEachChild(node, walk);
    };
    walk(n.body);
    if (usesDirect) direct.add(n.name.text);
  });
  return direct;
}

/** Every way `file` reaches a communication provider. Empty means it does not. */
function reasonsFor(file: string, src: string, direct: Set<string>): Reason[] {
  const reasons: Reason[] = [];
  if (/from\s+["']resend["']/.test(src)) reasons.push("resend-sdk");
  if (/from\s+["']twilio["']/.test(src)) reasons.push("twilio-sdk");
  if (file !== RESEND_SERVICE && [...direct].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(src))) {
    reasons.push("direct-sender");
  }
  if (/\bsendSms\s*\(|\bsendCrmSms\s*\(/.test(src)) reasons.push("sms");
  return reasons;
}

function scan(): Map<string, Reason[]> {
  const files = sourceFiles(ROOT, [...ROOTS]);
  assertScanned(files, 800, "no-direct-transactional-send");
  const direct = directRailExports();
  assert.ok(direct.size > 0, "the rail classifier found no direct senders — resend.service.ts changed shape and this rule is now blind");

  const out = new Map<string, Reason[]>();
  for (const file of files) {
    const reasons = reasonsFor(file, readFileSync(`${ROOT}/${file}`, "utf8"), direct);
    if (reasons.length) out.set(file, reasons);
  }
  return out;
}

test("no NEW direct transactional send — the allowlist is the whole permitted set", () => {
  const found = scan();
  const allowed = new Set(DIRECT_SEND_ALLOWLIST.map((e) => e.file));
  const offenders = [...found.entries()]
    .filter(([file]) => !allowed.has(file))
    .map(([file, reasons]) => `${file} (${reasons.join(", ")})`);

  assert.deepEqual(
    offenders,
    [],
    "§27 requires every transactional message to dispatch through the durable outbox. " +
      "Use enqueueTransactional() from lib/services/comms/transactional-dispatcher.service.ts. " +
      "If a send genuinely cannot go through the outbox, it must be added to the allowlist with the " +
      `phase that removes it — and that is a reviewable decision, not a formality. New: ${offenders.join(", ")}`
  );
});

test("no STALE allowlist entry — a file that no longer sends must be delisted", () => {
  const found = scan();
  const stale = DIRECT_SEND_ALLOWLIST.filter((e) => !found.has(e.file)).map((e) => e.file);
  assert.deepEqual(
    stale,
    [],
    "These files no longer reach a provider directly, so their allowlist entries are stale. " +
      "A stale entry is a hole: the next direct send added to that file would pass unnoticed. " +
      `Remove them, and let the count fall. Stale: ${stale.join(", ")}`
  );
});

test("each allowlist entry records how it sends and when it is removed", () => {
  const found = scan();
  for (const entry of DIRECT_SEND_ALLOWLIST) {
    assert.ok(entry.reasons.length > 0, `${entry.file}: an entry must say how it sends`);
    assert.equal(entry.removalPhase, 10, `${entry.file}: §8.4 removes every direct send in Phase 10`);
    // The recorded reasons must still match reality, or the ledger is describing a
    // tree that no longer exists.
    const actual = found.get(entry.file) ?? [];
    assert.deepEqual(
      [...entry.reasons].sort(),
      [...actual].sort(),
      `${entry.file}: the allowlist records ${entry.reasons.join("+")} but the file now uses ${actual.join("+") || "no provider"}`
    );
  }
});

test("the allowlist shrinks, never grows, without a deliberate edit", () => {
  // A number, stated once, that a reviewer can see move. §8.4: "Zero production
  // traffic is verified only by the LEGACY_PATH_WRITE counter"; this is the
  // static half of the same measurement.
  assert.equal(
    DIRECT_SEND_ALLOWLIST.length,
    // 97 → 95 in Phase 5. TWO PATHS MIGRATED, both off a SCHEDULED or untargeted rail:
    //   · app/api/cron/dealer-invitation-reminder/route.ts — the 50%/90% invitation reminders
    //     now go through `sweepInvitationReminders` → `enqueueTransactional`, keyed per
    //     invitation. The direct rail applied no suppression, so a dealership that bounced or
    //     unsubscribed was re-emailed on every sweep.
    //   · lib/services/acquisition/dealer-opportunity-notification.service.ts — retired
    //     outright under §13-D44; it assembles no dealer pool at all now.
    95,
    "The direct-send count changed. Going DOWN is the goal — update this number and say which path was migrated. " +
      "Going UP means a new direct send was added and needs justifying."
  );
});

test("the dispatcher itself is not a violation, and the rail classifier is honest", () => {
  const direct = directRailExports();
  // The five exports already routed through the dispatcher must NOT be classified
  // as direct — if they were, their callers would be false positives forever.
  for (const migrated of [
    "sendOffersReadyEmail",
    "sendDealSelectedEmail",
    "sendDealerOfferWonEmail",
    "sendDealerOfferLostEmail",
    "sendDealerAuctionClosedNoWinnerEmail",
  ]) {
    assert.ok(!direct.has(migrated), `${migrated} routes through enqueueTransactionalEmail and must not be classified as a direct sender`);
  }
  // And a known direct one must be.
  assert.ok(direct.has("sendAdverseActionEmail"), "sendAdverseActionEmail lands on sendIdempotent and must be classified direct");
});

test("the rule detects a real violation — proved against planted source", () => {
  const direct = directRailExports();

  const plantedSdk = `import { Resend } from "resend";\nconst r = new Resend(process.env.RESEND_API_KEY);\n`;
  assert.deepEqual(reasonsFor("app/api/buyer/planted/route.ts", plantedSdk, direct), ["resend-sdk"]);

  const plantedIndirect = `import { sendAdverseActionEmail } from "@/lib/services/email/resend.service";\nawait sendAdverseActionEmail({});\n`;
  assert.deepEqual(
    reasonsFor("app/api/buyer/planted2/route.ts", plantedIndirect, direct),
    ["direct-sender"],
    "an INDIRECT reach through resend.service must be caught — six of seven transaction-tree senders look like this"
  );

  const plantedDispatcher = `import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";\nawait enqueueTransactional({});\n`;
  assert.deepEqual(
    reasonsFor("app/api/buyer/ok/route.ts", plantedDispatcher, direct),
    [],
    "the compliant path must not trip the rule"
  );

  const plantedMigratedSender = `import { sendOffersReadyEmail } from "@/lib/services/email/resend.service";\nawait sendOffersReadyEmail({});\n`;
  assert.deepEqual(
    reasonsFor("app/api/buyer/ok2/route.ts", plantedMigratedSender, direct),
    [],
    "a sender already routed through the dispatcher must not trip the rule"
  );
});

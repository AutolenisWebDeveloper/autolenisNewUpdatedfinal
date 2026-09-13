// The seven defects §8.2 Phase 5 names, one regression test each, written to FAIL on the
// pre-Phase-5 code.
//
// Each test below states the line that was wrong and what it did. They are grouped in one file
// deliberately: the seven are a single body of evidence about one phase, and splitting them
// across seven files would make the set easy to erode one file at a time.
//
// WHAT "FAILING-FIRST" MEANS FOR EACH ONE is recorded in its own comment — the specific prior
// behaviour that makes the assertion false. Two of the seven could not have been written at all
// before this phase, because the function under test did not exist (the unified counter, the
// 50/90 rail); for those the comment names the code that stood in its place and what it returned.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/sourcing/__tests__/phase5-defect-regressions.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Type-only: the shapes under test, so the fixtures below cannot drift from them.
import type { SourcingCaseRecord } from "@/lib/services/sourcing/sourcing-case.service";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes
// ─────────────────────────────────────────────────────────────────────────────

interface Ctrl {
  /** Which suppression predicate the email rail actually consulted. */
  suppressionCalls: Array<"hard" | "full">;
  hardSuppressed: Set<string>;
  fullSuppressed: Set<string>;
  /** What reached the provider. */
  providerSends: Array<{ to: string; listUnsubscribeUrl?: string }>;
  /** Outbox rows the dispatcher was asked to write. */
  enqueued: Array<Record<string, unknown>>;
  /** Exceptions raised. */
  exceptions: Array<Record<string, unknown>>;
  /** Circumvention attempt rows written. */
  attempts: Array<Record<string, unknown>>;
  /** Invitation rows, keyed by id. */
  invitations: Map<string, Record<string, unknown>>;
  outsideInvites: number;
  unifiedInvitations: number;
  messages: Array<Record<string, unknown>>;
  threadUpdates: Array<Record<string, unknown>>;
  participantRole: string | null;
  sawTransaction: boolean;
  /** Whether a settled deposit is bound to the request under test (defect 3). */
  depositSettled: boolean;
  /** Every paid reveal the waterfall actually attempted, in order (defect 3). */
  paidReveals: Array<{ rooftopId: string; consumer?: string; sourcingCaseId?: string | null }>;
  /** `apollo_reveals` claim rows written by `revealRooftopContact` (defect 3). */
  revealClaims: Array<Record<string, unknown>>;
  /** Credits drawn from the ledger, in order (defect 3). */
  creditDraws: number[];
}
let ctrl: Ctrl;

beforeEach(() => {
  ctrl = {
    suppressionCalls: [],
    hardSuppressed: new Set(),
    fullSuppressed: new Set(),
    providerSends: [],
    enqueued: [],
    exceptions: [],
    attempts: [],
    invitations: new Map(),
    outsideInvites: 0,
    unifiedInvitations: 0,
    messages: [],
    threadUpdates: [],
    participantRole: null,
    sawTransaction: false,
    depositSettled: false,
    paidReveals: [],
    revealClaims: [],
    creditDraws: [],
  };
});

mock.module("server-only", { namedExports: {}, defaultExport: {} });

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

// ONE prisma mock for the whole file. `mock.module` is once-per-specifier per file, so every
// behaviour a test needs is driven through `ctrl` rather than by re-mocking — which is also what
// keeps each test's setup visible in the test itself.
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        ctrl.sawTransaction = true;
        return fn(txFake());
      },
      messageThreadParticipant: {
        findFirst: async () => (ctrl.participantRole ? { role: ctrl.participantRole } : null),
      },
      // `deliverEmail`'s transactional SENT-precheck. Returning null means "not sent before",
      // which is the state every test here wants.
      emailSendLog: {
        findUnique: async () => null,
        upsert: async () => ({}),
        create: async () => ({}),
      },
      auctionInvitation: { count: async () => ctrl.unifiedInvitations },
      outsideAuctionInvite: { count: async () => ctrl.outsideInvites },
      contact: { findUnique: async () => null },
    },
  },
});

mock.module("@/lib/services/trust/anti-circumvention.service", {
  namedExports: {
    recordCircumventionAttempt: async (input: Record<string, unknown>) => {
      ctrl.attempts.push(input);
      return {
        attemptId: "att_1",
        afterPaidAuction: ctrl.participantRole === "DEALER",
        dealerId: ctrl.participantRole === "DEALER" ? "d1" : null,
        dealerAttemptsInWindow: ctrl.participantRole === "DEALER" ? 1 : 0,
      };
    },
  },
});

mock.module("@/lib/services/template.service", {
  namedExports: { TemplateService: { renderTemplate: async () => ({ subject: "", html: "", text: "" }) } },
});

mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      isEmailHardSuppressed: async (_sb: unknown, email: string) => {
        ctrl.suppressionCalls.push("hard");
        return ctrl.hardSuppressed.has(email);
      },
      isEmailSuppressed: async (_sb: unknown, email: string) => {
        ctrl.suppressionCalls.push("full");
        return ctrl.fullSuppressed.has(email);
      },
    },
  },
});

mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({}) },
});

// Defect 3's gate. `advanceSourcing` imports this lazily (the static import would be a cycle:
// the payment gate reads vehicle requests and sourcing reads deposits), and a dynamic import
// resolves through `mock.module` the same as a static one.
mock.module("@/lib/services/payment/fulfillment-gate", {
  namedExports: {
    isRequestFulfillmentUnlocked: async () => ctrl.depositSettled,
    settledDepositForRequest: async () =>
      ctrl.depositSettled ? { id: "dep_1", status: "PAID", amountCents: 9900 } : null,
  },
});

mock.module("@/lib/services/comms/comms-providers", {
  namedExports: {
    sendEmailViaResend: async (args: { to: string; listUnsubscribeUrl?: string }) => {
      ctrl.providerSends.push({ to: args.to, listUnsubscribeUrl: args.listUnsubscribeUrl });
      return { id: "provider_1" };
    },
    sendSmsViaTwilio: async () => ({ sid: "sms_1" }),
    assertEmailTransportConfigured: () => {},
    isCaptureTransport: () => false,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 1 — the suppression tier, and the opt-out header
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST. `deliverEmail` derived the tier from `payload.type` alone
// (`comms-outbox.service.ts`, pre-Phase-5): `type === "transactional"` meant hard-only
// (bounced / complained / spam_trap) and anything else meant the full store. A dealer invitation
// is transactional, so it took the hard tier — and `email_suppression.reason = 'unsubscribed'`,
// which AutoLenis' own one-click dealer link writes
// (`app/api/public/dealer-unsubscribe/route.ts:15-26`) WITHOUT setting `do_not_contact`, is a
// SOFT reason the hard tier ignores. An unsubscribed dealership stayed fully mailable by every
// invitation and every reminder, forever, on an address that never opted in.
//
// Before the fix there was no `suppressionTier` field to pass, so test 1a asserted nothing that
// could hold: the full predicate was never consulted for a transactional payload.

test("defect 1a: an explicit suppressionTier:'full' consults the FULL store, not the hard tier", async () => {
  const { deliverEmail } = await import("@/lib/services/comms/comms-outbox.service");
  ctrl.fullSuppressed.add("sales@rooftop.example");

  const outcome = await deliverEmail({} as never, {
    email: "sales@rooftop.example",
    subject: "Auction invitation",
    html: "<p>hi</p>",
    text: "hi",
    type: "transactional",
    suppressionTier: "full",
    idempotencyKey: "dealer_invited_secure:email:inv_1",
  } as never);

  assert.equal(outcome.outcome, "SUPPRESSED", "an unsubscribed dealer address must not be mailed");
  assert.deepEqual(ctrl.suppressionCalls, ["full"], "the FULL store is the one that was asked");
  assert.equal(ctrl.providerSends.length, 0, "nothing reached the provider");
});

test("defect 1b: a BUYER's transactional mail still uses the hard tier — the old rule is preserved", async () => {
  // The half that must NOT change. §27's rule is that a buyer who unsubscribed from marketing
  // still receives their own deal emails, so widening the tier for everyone would have broken a
  // buyer's receipt to fix a dealer's opt-out.
  const { deliverEmail } = await import("@/lib/services/comms/comms-outbox.service");
  ctrl.fullSuppressed.add("buyer@example.com"); // soft-suppressed only

  const outcome = await deliverEmail({} as never, {
    email: "buyer@example.com",
    subject: "Your auction is live",
    html: "<p>hi</p>",
    text: "hi",
    type: "transactional",
    idempotencyKey: "auction_launched:email:vr_1",
  } as never);

  assert.deepEqual(ctrl.suppressionCalls, ["hard"], "omitting the tier keeps the derived behaviour");
  assert.equal(outcome.outcome, "SUCCESS", "a soft-suppressed buyer still gets their own deal email");
});

test("defect 1c: dealer mail carries a List-Unsubscribe that can identify the recipient", async () => {
  // The second half of defect 1. The provider's default header points at `/unsubscribe`, a
  // buyer-oriented page that cannot identify a dealership — a header that looks like an opt-out
  // and is not one. The dealer rail passes the token URL that actually suppresses the address.
  const { deliverEmail } = await import("@/lib/services/comms/comms-outbox.service");
  const tokenUrl = "https://app.example/api/public/dealer-unsubscribe?token=abc";

  await deliverEmail({} as never, {
    email: "sales@rooftop.example",
    subject: "Auction invitation",
    html: "<p>hi</p>",
    text: "hi",
    type: "transactional",
    suppressionTier: "full",
    listUnsubscribeUrl: tokenUrl,
    idempotencyKey: "dealer_invited_secure:email:inv_2",
  } as never);

  assert.equal(ctrl.providerSends.length, 1);
  assert.equal(ctrl.providerSends[0]!.listUnsubscribeUrl, tokenUrl);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 2 — operating status on the outside-rooftop pool
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST. `outside-invite.service.ts:223-244` selected the outside pool with exactly two
// where-clauses — a lat/long bounding box and `contacts.some` send-safe email — and the string
// `operatingStatus` appeared nowhere in the file. A rooftop recorded as closed was as invitable
// as one recorded as open, because nothing read the column.
//
// The D36 sub-ruling makes this a NEGATIVE filter, so the test has two halves and the second is
// the one that stops the fix from being worse than the defect: UNKNOWN must still pass, because
// the column is unpopulated and requiring 'ACTIVE' would reject every rooftop in production.

async function validate(rooftopOverrides: Record<string, unknown>) {
  const { validateRooftop } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  return validateRooftop(
    {
      rooftop: {
        rooftopId: "rt_1",
        displayName: "Example Motors",
        latitude: 32.8,
        longitude: -96.8,
        makes: ["Toyota"],
        operatingStatus: null,
        websiteHost: "example.com",
        dealer: null,
        contact: {
          name: "Sales",
          title: "Internet Sales Manager",
          email: "sales@example.com",
          phone: "2145551234",
          emailVerificationStatus: "VERIFIED",
          contactSource: "apollo",
        },
        ...rooftopOverrides,
      },
      buyerCoords: { lat: 32.8, lng: -96.8 },
      radiusMiles: 100,
      servedCandidateIds: ["inv_1"],
      candidateMakes: new Set(["Toyota"]),
      alreadyCounted: new Set<string>(),
      allowPaid: false,
    },
    {
      resolveContact: async () => ({ contactable: true, email: "sales@example.com", status: "VERIFIED" }),
      channelConfigured: () => true,
    },
  );
}

test("defect 2a: a rooftop recorded CLOSED is not invitation-ready", async () => {
  const v = await validate({ operatingStatus: "CLOSED" });
  assert.equal(v.invitationReady, false);
  assert.ok(v.failures.includes("OPERATING_STATUS_CLOSED"), `failures were ${v.failures.join(",")}`);
  assert.equal(v.operatingStatus, "CLOSED");
});

test("defect 2b: a rooftop with NO recorded status is still invitation-ready (D36 sub-ruling)", async () => {
  // The half that keeps the platform running. `operating_status` is nullable TEXT that nothing
  // has ever written, so a predicate requiring 'ACTIVE' would reject all 1,422 production
  // rooftops and produce zero coverage for every buyer — fail-closed, in production.
  const v = await validate({ operatingStatus: null });
  assert.equal(v.operatingStatus, "UNKNOWN");
  assert.ok(!v.failures.includes("OPERATING_STATUS_CLOSED"));
  assert.equal(v.invitationReady, true, "absence of a value is not evidence of closure");
});

test("defect 2 (bonus): a rooftop we cannot place is not invitation-ready — S6-13 fails closed", async () => {
  // The legacy coverage counter included a coordless dealer when the buyer WAS placeable, while
  // the invite path discarded it — so a field could be counted and then not invited.
  const v = await validate({ latitude: null, longitude: null });
  assert.equal(v.invitationReady, false);
  assert.ok(v.failures.includes("LOCATION_UNKNOWN"));
  assert.equal(v.distanceMiles, null);
});

test("defect 2 (bonus): a suspended dealer's rooftop is not invitation-ready — D42's enforcement point", async () => {
  // §13-D42: Phase 5 records and warns, Phase 10 enforces. The READ exists from the start, so
  // Phase 10's suspension write bites immediately instead of needing a reader built for it.
  const v = await validate({
    dealer: { id: "d1", status: "SUSPENDED", currentAuctionLoad: 0, email: "d@x.com", dealershipName: "D" },
  });
  assert.equal(v.invitationReady, false);
  assert.ok(v.failures.includes("DEALER_SUSPENDED"));
});

test("defect 2 (bonus): a phone-only rooftop is CALL_ONLY, not invitation-ready and not dropped", async () => {
  // The channel decision, mechanically. SMS is out of scope this phase, so a rooftop with a
  // phone and no send-safe email cannot be reached by the automated rail — and it must not be
  // counted as reachable either, or "invitations sent" would read as "the market was reached".
  const { validateRooftop } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const v = await validateRooftop(
    {
      rooftop: {
        rooftopId: "rt_phone",
        displayName: "Phone Only Motors",
        latitude: 32.8,
        longitude: -96.8,
        makes: ["Toyota"],
        operatingStatus: null,
        websiteHost: null,
        dealer: null,
        contact: {
          name: "Sales",
          title: "Sales Manager",
          email: null,
          phone: "2145551234",
          emailVerificationStatus: null,
          contactSource: null,
        },
      },
      buyerCoords: { lat: 32.8, lng: -96.8 },
      radiusMiles: 100,
      servedCandidateIds: ["inv_1"],
      candidateMakes: new Set(["Toyota"]),
      alreadyCounted: new Set<string>(),
      allowPaid: false,
    },
    {
      resolveContact: async () => ({ contactable: false }),
      channelConfigured: () => true,
    },
  );
  assert.equal(v.channel, "CALL_ONLY");
  assert.equal(v.invitationReady, false);
  assert.ok(v.failures.includes("NO_DELIVERABLE_CONTACT"));
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 3 — paid Apollo credits with no link to a paid request
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST, in two halves, because the defect had two halves.
//
// (a) THE GATE. Before this phase the only caller that could set `allowPaid` was a dealer
//     selected for an auction, and the thing that decided "a live auction exists" was the
//     request's STATUS. `request-progression.service.ts:123` writes `ACTIVE_SOURCING` with no
//     deposit check, driven every 15 minutes by the `coverage-hold-reconcile` cron — so a
//     status-derived gate says "paid" for a request nobody has paid for. `advanceSourcing`
//     reads the DEPOSIT instead, and reads it BEFORE anything that can spend, so an unpaid
//     request does not reach the pool query, never mind the waterfall.
//
// (b) THE LINK. `RevealInput` had no field naming the request a live credit was spent for, and
//     `apollo_reveals` had no column to hold one (the column is added by this phase's
//     migration). A `consumer: "live"` draw was therefore auditable only as far as the rooftop
//     — "two credits left the ledger for rt_4821" with nothing saying which buyer's paid
//     request authorised it. `resolveContactableEmail` now REFUSES the paid tier when
//     `allowPaid` arrives with no `sourcingCaseId`, and `revealRooftopContact` stamps the id on
//     the claim row, so every live spend carries its authorisation in the database.
//
// The two halves are tested separately on purpose: a gate with no link leaves spend
// unattributable, and a link with no gate just records an unauthorised spend accurately.

// Typed as the real record, so a field added to `SourcingCaseRecord` breaks this fixture rather
// than reaching `advanceSourcing` as undefined.
function fulfillmentGateCase(): SourcingCaseRecord {
  return {
    id: "case_1",
    vehicleRequestId: "vr_1",
    status: "ACTIVE_SOURCING",
    band: "100",
    coverageCount: 0,
    authorizedRadiusMiles: null,
    authorizationRequestedAt: null,
    limitedAuctionApprovedBy: null,
    limitedAuctionApprovedAt: null,
    bandExpandedAt: null,
    openedAt: new Date("2026-09-01T00:00:00Z"),
    closedAt: null,
    closeReason: null,
  };
}

test("defect 3a: an unpaid request does not source — NOT_PAID, before anything can spend", async () => {
  const { advanceSourcing } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  ctrl.depositSettled = false;

  let requestsRead = 0;
  let rooftopsRead = 0;
  const resolveCalls: unknown[] = [];
  const result = await advanceSourcing("vr_1", fulfillmentGateCase(), {
    // Every table a spending path would have to touch counts its own reads, so the assertion
    // is "nothing ran", not "the return value was NOT_PAID".
    prisma: {
      vehicleRequest: {
        findUnique: async () => {
          requestsRead += 1;
          return null;
        },
      },
      dealerRooftop: {
        findMany: async () => {
          rooftopsRead += 1;
          return [];
        },
        count: async () => {
          rooftopsRead += 1;
          return 0;
        },
      },
      sourcingCandidate: { findMany: async () => [] },
    } as never,
    resolveContact: async (c: unknown) => {
      resolveCalls.push(c);
      return { contactable: false };
    },
    channelConfigured: () => true,
  });

  assert.equal(result.outcome, "NOT_PAID");
  assert.equal(requestsRead, 0, "the request was read before the deposit was proven");
  assert.equal(rooftopsRead, 0, "a rooftop pool was assembled for an unpaid request");
  assert.equal(resolveCalls.length, 0, "the contact waterfall ran for an unpaid request");
});

test("defect 3b: the live paid tier is refused when allowPaid carries no sourcing case", async () => {
  // `allowPaid: true` alone is a caller's claim. Without the case id the spend would be real
  // and its authorisation would be a log line, so the waterfall declines to spend.
  const { resolveContactableEmail } = await import(
    "@/lib/services/dealer-recruitment/contact-resolution.service"
  );
  const resolved = await resolveContactableEmail(
    {
      id: "p_1",
      name: "Example Motors",
      website: "example.com",
      city: "Dallas",
      state: "TX",
      email: null,
      emailVerificationStatus: null,
      rooftopId: "rt_1",
      allowPaid: true,
      // sourcingCaseId deliberately absent — this is the defect's shape.
    },
    {
      prisma: { dealerProspect: { update: async () => ({}) } } as never,
      supabase: {} as never,
      getRooftopContacts: async () => [],
      upsertContactProfile: async () => ({ id: "profile_1" }),
      // Every free tier must MISS, or this would be a test of the tiers above the paid one.
      // Modelled the way the real miss looks: the dealership's role inboxes do not resolve
      // (`sales@`, `internetsales@` … are undeliverable) and Gemini finds nobody, so tier 4 is
      // the only tier left. Only the address Apollo would return is deliverable.
      enrich: async () => ({ email: null }) as never,
      verifyDeliverability: async (email: string) =>
        ({ deliverable: email === "paid@example.com" }) as never,
      isEmailSuppressed: async () => false,
      revealRooftopContact: async (input: {
        rooftopId: string;
        consumer?: string;
        sourcingCaseId?: string | null;
      }) => {
        ctrl.paidReveals.push({
          rooftopId: input.rooftopId,
          consumer: input.consumer,
          sourcingCaseId: input.sourcingCaseId ?? null,
        });
        return { email: "paid@example.com", status: "VERIFIED" as const, contactName: null, contactTitle: null };
      },
    },
  );

  assert.equal(ctrl.paidReveals.length, 0, "a paid reveal fired with no case to bill it to");
  assert.equal(resolved.contactable, false);
  assert.notEqual(resolved.source, "apollo");
});

test("defect 3b: with a sourcing case the paid tier runs, and carries the case to the reveal", async () => {
  // The other direction. A refusal that also refused the legitimate caller would have turned
  // the paid tier off rather than linked it, so both directions are asserted.
  const { resolveContactableEmail } = await import(
    "@/lib/services/dealer-recruitment/contact-resolution.service"
  );
  const resolved = await resolveContactableEmail(
    {
      id: "p_1",
      name: "Example Motors",
      website: "example.com",
      city: "Dallas",
      state: "TX",
      email: null,
      emailVerificationStatus: null,
      rooftopId: "rt_1",
      allowPaid: true,
      sourcingCaseId: "case_1",
    },
    {
      prisma: { dealerProspect: { update: async () => ({}) } } as never,
      supabase: {} as never,
      getRooftopContacts: async () => [],
      upsertContactProfile: async () => ({ id: "profile_1" }),
      // Same miss as above: only the revealed address is deliverable.
      enrich: async () => ({ email: null }) as never,
      verifyDeliverability: async (email: string) =>
        ({ deliverable: email === "paid@example.com" }) as never,
      isEmailSuppressed: async () => false,
      revealRooftopContact: async (input: {
        rooftopId: string;
        consumer?: string;
        sourcingCaseId?: string | null;
      }) => {
        ctrl.paidReveals.push({
          rooftopId: input.rooftopId,
          consumer: input.consumer,
          sourcingCaseId: input.sourcingCaseId ?? null,
        });
        return { email: "paid@example.com", status: "VERIFIED" as const, contactName: null, contactTitle: null };
      },
    },
  );

  assert.equal(ctrl.paidReveals.length, 1);
  assert.equal(ctrl.paidReveals[0].consumer, "live");
  assert.equal(ctrl.paidReveals[0].sourcingCaseId, "case_1");
  assert.equal(resolved.contactable, true);
  assert.equal(resolved.source, "apollo");
});

test("defect 3c: the claim row carries sourcing_case_id — the link survives in the database", async () => {
  // The assertion that makes the link durable rather than a parameter passed and dropped.
  // Stamped on the CLAIM, so a drawn-but-empty attempt is attributed too: those are the
  // credits hardest to account for after the fact.
  const { revealRooftopContact } = await import(
    "@/lib/services/dealer-recruitment/apollo-reveal.service"
  );
  const revealed = await revealRooftopContact(
    {
      rooftopId: "rt_1",
      name: "Example Motors",
      website: "example.com",
      city: "Dallas",
      state: "TX",
      consumer: "live",
      sourcingCaseId: "case_1",
    },
    {
      now: new Date("2026-09-11T00:00:00Z"),
      enabled: () => true,
      resolveAndReveal: async () =>
        ({ kind: "revealed", creditsBilled: 2, email: "paid@example.com", name: "Sam", title: "Internet Sales Manager" }) as never,
      prisma: {
        apolloReveal: {
          findFirst: async () => null,
          create: async (args: { data: Record<string, unknown> }) => {
            ctrl.revealClaims.push(args.data);
            return { id: "rev_1", ...args.data };
          },
          update: async (args: { data: Record<string, unknown> }) => {
            ctrl.revealClaims.push({ update: true, ...args.data });
            return {};
          },
          delete: async () => ({}),
        },
        apolloCreditLedger: {
          findUnique: async () => ({ id: "l1", cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 }),
          updateMany: async (args: { data: { spentCredits: { increment?: number; decrement?: number } } }) => {
            const inc = args.data.spentCredits.increment;
            if (inc) ctrl.creditDraws.push(inc);
            return { count: 1 };
          },
        },
      } as never,
    },
  );

  assert.equal(revealed?.email, "paid@example.com");
  const claim = ctrl.revealClaims.find((r) => r.status === "PENDING");
  assert.ok(claim, "no claim row was written");
  assert.equal(claim.sourcingCaseId, "case_1", "the claim row did not record the authorising case");
  assert.equal(claim.consumer, "live");
  assert.ok(ctrl.creditDraws.length >= 1, "no credits were drawn, so this proves nothing about spend");
});

test("defect 3c: a backfill reveal carries no case and is not required to — the rails stay separate", async () => {
  // CAPABILITY PRESERVED. The unattended gap-fill (`backfillSpendEnabled()`, default off) has
  // no per-request caller by design. Demanding a case id of it would have disabled it, which
  // is feature removal dressed as a security fix.
  const { revealRooftopContact } = await import(
    "@/lib/services/dealer-recruitment/apollo-reveal.service"
  );
  const revealed = await revealRooftopContact(
    { rooftopId: "rt_2", name: "Backfill Motors", website: "b.example.com", consumer: "backfill" },
    {
      now: new Date("2026-09-11T00:00:00Z"),
      enabled: () => true,
      resolveAndReveal: async () =>
        ({ kind: "revealed", creditsBilled: 2, email: "b@example.com", name: null, title: null }) as never,
      prisma: {
        apolloReveal: {
          findFirst: async () => null,
          create: async (args: { data: Record<string, unknown> }) => {
            ctrl.revealClaims.push(args.data);
            return { id: "rev_2", ...args.data };
          },
          update: async () => ({}),
          delete: async () => ({}),
        },
        apolloCreditLedger: {
          findUnique: async () => ({ id: "l1", cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 }),
          updateMany: async () => ({ count: 1 }),
        },
      } as never,
    },
  );

  assert.equal(revealed?.email, "b@example.com");
  const claim = ctrl.revealClaims.find((r) => r.status === "PENDING");
  assert.ok(claim);
  assert.equal(claim.consumer, "backfill");
  assert.equal(claim.sourcingCaseId, null, "a backfill claim should carry an explicit null, not a borrowed case");
});

test("defect 3d: sourcing threads its own case id into the waterfall — the tier is reachable", async () => {
  // The wiring between (a) and (b). `validateRooftop` is the only thing that sets
  // `allowPaid: true`, so if it did not also pass the case id the refusal above would turn the
  // paid tier off platform-wide instead of linking it.
  const { validateRooftop } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const seen: Array<{ allowPaid?: boolean; sourcingCaseId?: string | null }> = [];
  await validateRooftop(
    {
      rooftop: {
        rooftopId: "rt_1",
        displayName: "Example Motors",
        latitude: 32.8,
        longitude: -96.8,
        makes: ["Toyota"],
        operatingStatus: null,
        websiteHost: "example.com",
        dealer: null,
        contact: null,
      },
      buyerCoords: { lat: 32.8, lng: -96.8 },
      radiusMiles: 100,
      servedCandidateIds: ["inv_1"],
      candidateMakes: new Set(["Toyota"]),
      alreadyCounted: new Set<string>(),
      allowPaid: true,
      sourcingCaseId: "case_1",
    },
    {
      resolveContact: async (c: { allowPaid?: boolean; sourcingCaseId?: string | null }) => {
        seen.push({ allowPaid: c.allowPaid, sourcingCaseId: c.sourcingCaseId });
        return { contactable: false };
      },
      channelConfigured: () => true,
    },
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0].allowPaid, true);
  assert.equal(seen[0].sourcingCaseId, "case_1", "the case id was dropped between sourcing and the waterfall");
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 6 — outside-only auctions counted as zero-invitation
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST. `deposit-activation.service.ts:133` counted
// `_count: { select: { invitations: true, offers: true } }`. `Auction.outsideInvites`
// (`schema.prisma:506`) was counted nowhere — not in that `_count`, not in the sweep predicate
// at `:334`. So an auction contacted ONLY through `OutsideAuctionInvite` read as
// zero-invitation and the reconciler closed it at the 120-minute grace, after which every live
// token was rejected `AUCTION_INACTIVE` (`outside-invite.service.ts:54`).
//
// There was no unified counter to test before this phase; the behaviour under test was the
// `_count` expression itself, which returned 0 for this shape.

test("defect 6: an auction contacted only through outside invites counts as REACHED", async () => {
  const { countReachedInvitations } = await import("@/lib/services/auction/auction-invitation.service");

  ctrl.unifiedInvitations = 0;
  ctrl.outsideInvites = 3;
  const counted = await countReachedInvitations("a1");

  assert.equal(counted.unified, 0, "no unified invitation rows — the pre-Phase-5 shape");
  assert.equal(counted.legacyOutside, 3);
  assert.equal(counted.total, 3, "three dealerships were contacted, so the auction is not empty");
  assert.ok(counted.total > 0, "the reconciler's close-on-zero must not fire for this auction");
});

test("defect 6: both pools add up, so a mixed auction is not double-discounted", async () => {
  const { countReachedInvitations } = await import("@/lib/services/auction/auction-invitation.service");
  ctrl.unifiedInvitations = 5;
  ctrl.outsideInvites = 2;
  const counted = await countReachedInvitations("a1");
  assert.equal(counted.total, 7);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 7 — §25.2 scanning was buyer-only, and unattributable
// ─────────────────────────────────────────────────────────────────────────────
//
// FAILING-FIRST, in two ways.
//
//   (a) `sendMessage` had exactly ONE caller — `app/api/buyer/messages/route.ts:77` — so a
//       dealer's message was never scanned at all. Both dealer writers called
//       `prisma.message.create` directly with `isRedacted: false` hard-coded
//       (`app/api/dealer/messages/route.ts:78`, `.../threads/[threadId]/route.ts:62`), and
//       `lib/prisma.ts` is a bare `new PrismaClient` with no middleware, so nothing could have
//       caught them.
//   (b) `recordCircumventionAttempt` had ZERO callers, so no attempt row existed for any
//       direction — and it took no `initiatorRole`, because the message row cannot answer who
//       sent it: `Message.senderId` is a bare String with no relation and `MessageThread`
//       carries neither `buyerId` nor `dealerId`.

test("defect 7a: a DEALER-initiated contact attempt is scanned, redacted and flagged", async () => {
  ctrl.participantRole = "DEALER";

  const { sendMessage } = await import("@/lib/services/messaging/messaging.service");
  const result = await sendMessage("t1", "dealer_user_1", "Call me directly on 214-555-1234");

  assert.equal(result.isRedacted, true, "a dealer's contact attempt must be redacted too");
  assert.equal(ctrl.messages.length, 1);
  assert.equal(
    ctrl.messages[0]!.content,
    "[Message redacted — possible policy violation]",
    "the stored body is the redaction, not the phone number",
  );
  assert.equal(ctrl.messages[0]!.isRedacted, true);
});

test("defect 7b: the attempt is attributed to the DEALER, with the matched pattern", async () => {
  ctrl.participantRole = "DEALER";

  const { sendMessage } = await import("@/lib/services/messaging/messaging.service");
  await sendMessage("t1", "dealer_user_1", "let's do this off platform");

  assert.equal(ctrl.attempts.length, 1, "a detection must write an attempt row");
  const a = ctrl.attempts[0]!;
  assert.equal(a.initiatorRole, "DEALER", "25-09a: the initiating party is recorded");
  assert.equal(a.flag, "EXTERNAL_DEAL");
  // §25.2 requires "a record with the MATCHED PATTERN". Before this phase the only thing stored
  // was a category string in `Message.redactReason` ("Off-platform deal attempt"), and the
  // original text was overwritten and lost.
  assert.ok(typeof a.pattern === "string" && (a.pattern as string).length > 0);
  assert.equal(a.matchedText, "off platform", "the matched substring, for Operations review");
});

test("defect 7c: a BUYER-initiated attempt is recorded as the buyer's, not the dealer's", async () => {
  // §25.2: "Buyers are protected, not penalized, when the dealership initiates." That rule is
  // only applicable if the row says WHICH party initiated — and symmetric scanning without
  // attribution would make every detection look the same.
  ctrl.participantRole = "BUYER";

  const { sendMessage } = await import("@/lib/services/messaging/messaging.service");
  await sendMessage("t1", "buyer_user_1", "email me at me@example.com");
  assert.equal(ctrl.attempts[0]!.initiatorRole, "BUYER");
});

test("defect 7d: a clean message is neither redacted nor recorded", async () => {
  // The other direction, so the fix cannot be "flag everything". A symmetric scanner that
  // redacted benign dealer messages would break the conversation §25.2 exists to keep on-platform.
  ctrl.participantRole = "DEALER";

  const { sendMessage } = await import("@/lib/services/messaging/messaging.service");
  const r = await sendMessage("t1", "dealer_user_1", "The vehicle is available and ready for pickup.");
  assert.equal(r.isRedacted, false);
  assert.equal(ctrl.attempts.length, 0);
  assert.equal(ctrl.messages[0]!.content, "The vehicle is available and ready for pickup.");
  // And the thread is NOT flagged.
  assert.ok(!ctrl.threadUpdates.some((u) => JSON.stringify(u).includes("FLAGGED")));
});

test("defect 7e: the message and the thread flag commit together", async () => {
  // `sendMessage` was four sequential awaits with the notification swallowed, while the UNSCANNED
  // buyer-support branch four lines away in the same route used `$transaction`. A failure between
  // the insert and the flag left a redacted message in an ACTIVE thread with no flag, no alert and
  // no error surfaced — a silently lost detection.
  ctrl.participantRole = "DEALER";
  const { sendMessage } = await import("@/lib/services/messaging/messaging.service");
  await sendMessage("t1", "dealer_user_1", "ping me on venmo");
  assert.equal(ctrl.sawTransaction, true, "the message and the flag must be one transaction");
  assert.equal(ctrl.messages.length, 1);
  assert.equal(ctrl.threadUpdates.length, 1, "the thread update is inside the same transaction");
});

function txFake() {
  return {
    message: {
      create: async (args: { data: Record<string, unknown> }) => {
        ctrl.messages.push(args.data);
        return { id: `m${ctrl.messages.length}`, sentAt: new Date("2026-09-11T00:00:00Z") };
      },
    },
    messageThread: {
      update: async (args: Record<string, unknown>) => {
        ctrl.threadUpdates.push(args);
        return {};
      },
    },
  };
}

// ── #422 review ratchets: two single lines whose regression is SILENT ─────────
//
// Both of these were wrong in the reviewed branch and neither had a test. They are pinned at
// source level, the same idiom as `no-direct-transactional-send.test.ts` and
// `nav-capability-preservation.test.ts`, because the harm in each case is a value that reaches a
// person — a buyer's count, a buyer's ZIP — through a path no unit assertion was watching.

test("the buyer's auction-launched notice is rendered from NOTICES DISPATCHED, not rows written", () => {
  const src = readFileSync("lib/services/sourcing/sourcing-driver.service.ts", "utf8");
  assert.match(
    src,
    /dealershipsInvited:\s*launch\.noticesDispatched/,
    "a dealership holding an invitation row nobody emailed is not competing for this buyer",
  );
  assert.doesNotMatch(src, /dealershipsInvited:\s*launch\.invitationsIssued/);
});

test("the dealer-facing general location never falls back to the buyer's ZIP", () => {
  const src = readFileSync("lib/services/auction/auction-invitation.service.ts", "utf8");
  const chain = /const generalLocation =\s*\n?\s*\[req\.city, req\.state\]\.filter\(Boolean\)\.join\(", "\)\s*\|\|\s*([^;]+);/
    .exec(src);
  assert.ok(chain, "the generalLocation fallback chain moved — re-pin this assertion");
  assert.doesNotMatch(chain[1]!, /req\.zip/,
    "§25.1 permits a general location, and a ZIP is narrower than the city/state it replaces");
});

test("submitting an offer stamps offerSubmittedAt, the field four Phase 5 gates read", () => {
  // Found by review on #422. `offerSubmittedAt` was read by `skipIfInvitationNoLongerSendable`
  // (state-recheck-registry.ts), by `alreadyBid` on the token page, by the resume-link gate and
  // by the decline route — and written by nothing on the dealer's normal submission path, which
  // set only `respondedAt`. All four gates were therefore inert: a dealer who had already bid
  // still received the 24h and 72h reminders.
  //
  // `respondedAt` cannot stand in for it: a decline is also a response.
  const src = readFileSync("lib/services/offer/offer.service.ts", "utf8");
  const update = /tx\.auctionInvitation\.update\(\{[\s\S]*?\}\);/.exec(src);
  assert.ok(update, "the invitation update in submitOffer moved — re-pin this assertion");
  assert.match(update[0], /offerSubmittedAt:\s*new Date\(\)/,
    "without this write, every gate that reads offerSubmittedAt is dead code");
  assert.match(update[0], /respondedAt:\s*new Date\(\)/, "and respondedAt must still be set");
});

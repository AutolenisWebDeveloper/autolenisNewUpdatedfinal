// §27 — every Phase 7 template has a registered state recheck, and every renderer produces a
// sendable payload.
//
// Run with:  npx tsx --test lib/services/comms/__tests__/phase7-templates.test.ts
//
// WHY THIS SUITE EXISTS, and it is not hypothetical. `RETURNED_TO_OFFERS` shipped without a
// registered recheck. `enqueueTransactional` throws on an unregistered template, the call site
// caught it with `.catch(() => undefined)`, and the result was that the §27.1 notice §Stage 10
// owes a buyer — "returned to the remaining valid offers WITH THE REASON STATED" — silently never
// enqueued, while every other assertion about the stand-down passed. It was found by a Playwright
// journey asserting the outbox ROW; nothing at the unit level would have caught it.
//
// So this is the class-level fix rather than the instance-level one: the registry is checked
// against the template constant, so a template added without a recheck fails the build instead of
// failing quietly at run time in one branch of one service.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import {
  PHASE_7_TEMPLATES,
  hasStateRecheck,
  alwaysSendReasonFor,
} from "../state-recheck-registry";
import {
  renderReaffirmationRequest,
  renderReaffirmationReminder,
  renderDealerConfirmed,
  renderMaterialChangeProposed,
  renderReturnedToOffers,
  renderVehicleHoldExpiring,
  renderRecapReady,
  renderFinancingPathSelected,
  renderFinancingInProgress,
  renderFinancingTermsLocked,
  renderFinancingFailedOrExpired,
  renderPremiumFollowUpFinal,
  renderOutsideDealerVerification,
} from "../phase7-email-content";

test("every Phase 7 template key has a registered state recheck", () => {
  const missing = Object.entries(PHASE_7_TEMPLATES)
    .filter(([, key]) => !hasStateRecheck(key))
    .map(([name, key]) => `${name} (${key})`);
  assert.deepEqual(
    missing,
    [],
    "§27 requires a send-time state recheck on every transactional message, and " +
      "`enqueueTransactional` THROWS without one. A template registered nowhere becomes a notice " +
      `that silently never sends. Unregistered: ${missing.join(", ")}`,
  );
});

test("every alwaysSend template states why it needs no live read", () => {
  // `alwaysSend` is the escape hatch, and an escape hatch with no reason is a shrug. The reason is
  // what a reviewer reads to decide whether the claim is true.
  const alwaysSendKeys = [
    PHASE_7_TEMPLATES.DEALER_CONFIRMED,
    PHASE_7_TEMPLATES.RETURNED_TO_OFFERS,
    PHASE_7_TEMPLATES.FINANCING_PATH_SELECTED,
    PHASE_7_TEMPLATES.OUTSIDE_DEALER_VERIFICATION,
    PHASE_7_TEMPLATES.PREMIUM_FOLLOW_UP_FINAL,
  ];
  for (const key of alwaysSendKeys) {
    const reason = alwaysSendReasonFor(key);
    assert.ok(reason && reason.length > 60, `${key}: an alwaysSend needs a reason, not a label`);
  }
});

test("template keys are unique — a collision would make two notices share a dedup key", () => {
  const values = Object.values(PHASE_7_TEMPLATES);
  assert.equal(new Set(values).size, values.length, "two templates share a key");
});

test("no Phase 7 template key collides with an earlier phase's", async () => {
  const { PHASE_2_TEMPLATES, PHASE_5_TEMPLATES, PHASE_6_TEMPLATES } = await import("../state-recheck-registry");
  const earlier = new Set<string>([
    ...Object.values(PHASE_2_TEMPLATES),
    ...Object.values(PHASE_5_TEMPLATES),
    ...Object.values(PHASE_6_TEMPLATES),
  ]);
  const collisions = Object.values(PHASE_7_TEMPLATES).filter((k) => earlier.has(k));
  assert.deepEqual(collisions, [], `a reused key would overwrite an earlier recheck: ${collisions.join(", ")}`);
});

const RENDERED = [
  ["reaffirmation request", renderReaffirmationRequest({ dealershipName: "D", vehicle: "2023 Honda Accord", vin: "1HGCM82633A004352", otdCents: 4_120_000, dueAt: new Date("2026-10-01T00:00:00Z"), dealId: "d1" })],
  ["reaffirmation reminder", renderReaffirmationReminder({ dealershipName: "D", vehicle: "V", dueAt: new Date("2026-10-01T00:00:00Z"), dealId: "d1" })],
  ["dealer confirmed", renderDealerConfirmed({ firstName: "Sam", dealId: "d1", autoAppliedSavingCents: null })],
  ["dealer confirmed with a saving", renderDealerConfirmed({ firstName: "Sam", dealId: "d1", autoAppliedSavingCents: 40_000 })],
  ["material change", renderMaterialChangeProposed({ firstName: "Sam", dealId: "d1", differences: [{ label: "Out-the-door price", confirmed: "$41,200", proposed: "$42,600", consequence: "You would pay $1,400 more." }] })],
  ["returned to offers", renderReturnedToOffers({ firstName: "Sam", reason: "The dealership did not confirm in time.", remainingOfferCount: 2, auctionId: "a1" })],
  ["returned to offers, none left", renderReturnedToOffers({ firstName: "Sam", reason: "x", remainingOfferCount: 0, auctionId: null })],
  ["hold expiring", renderVehicleHoldExpiring({ firstName: "Sam", holdUntil: new Date("2026-10-01T00:00:00Z"), expired: false, dealId: "d1" })],
  ["recap ready", renderRecapReady({ recipientName: "Sam", version: 1, otdCents: 4_120_000, dealId: "d1", forDealer: false, isRevision: false })],
  ["recap revision", renderRecapReady({ recipientName: "D", version: 2, otdCents: null, dealId: "d1", forDealer: true, isRevision: true })],
  ["financing path", renderFinancingPathSelected({ firstName: "Sam", path: "EXTERNAL", dealId: "d1" })],
  ["financing in progress", renderFinancingInProgress({ firstName: "Sam", missingEvidence: true, dealId: "d1" })],
  ["terms locked", renderFinancingTermsLocked({ recipientName: "Sam", cash: false, approvedAmountCents: 4_500_000, aprRate: 6.4, termMonths: 60, dealId: "d1", forDealer: false })],
  ["cash confirmed", renderFinancingTermsLocked({ recipientName: "Sam", cash: true, approvedAmountCents: null, aprRate: null, termMonths: null, dealId: "d1", forDealer: false })],
  ["financing failed", renderFinancingFailedOrExpired({ firstName: "Sam", expired: false, failureReason: "Debt ratio", dealId: "d1" })],
  ["premium final", renderPremiumFollowUpFinal({ firstName: "Sam", balanceCents: 40_000, dealId: "d1" })],
  ["outside verification", renderOutsideDealerVerification({ dealershipName: "D", missing: ["claim the account"] })],
] as const;

test("every renderer produces a subject, html and text — the drain needs all three", () => {
  for (const [name, r] of RENDERED) {
    assert.ok(r.subject.length > 0, `${name}: no subject`);
    assert.ok(r.html.length > 0, `${name}: no html`);
    assert.ok(r.text.length > 0, `${name}: no text — a text part is not optional for deliverability`);
  }
});

test("no dealer-facing template carries buyer identity — §25.1 holds in the inbox too", () => {
  // The reaffirmation REQUEST goes out BEFORE the firewall lifts. A template that named the buyer
  // would release identity a stage early, to an inbox that forwards.
  const dealerFacing = [
    renderReaffirmationRequest({ dealershipName: "D", vehicle: "V", vin: "1HGCM82633A004352", otdCents: 1, dueAt: new Date(0), dealId: "d1" }),
    renderReaffirmationReminder({ dealershipName: "D", vehicle: "V", dueAt: new Date(0), dealId: "d1" }),
    renderOutsideDealerVerification({ dealershipName: "D", missing: ["x"] }),
  ];
  for (const r of dealerFacing) {
    const blob = `${r.subject} ${r.html} ${r.text}`;
    // The renderers take no buyer name, email or phone argument at all — the strongest form of the
    // guarantee is structural. This asserts the rendered output too, so a later edit that threads
    // one in has to delete a test.
    assert.equal(/@/.test(blob.replace(/mailto:|https?:\/\/[^\s"']+/g, "")), false, "no address in a pre-lift dealer template");
  }
});

test("the material-change email states the difference and links out — it does not ask for a decision", () => {
  // §10a's decision is a single accept-or-reject made where both columns are visible side by side.
  // A reply-to-accept in an inbox is unauthenticated, unlogged and impossible to present as a
  // comparison, so the email names the change and links to the screen.
  const r = renderMaterialChangeProposed({
    firstName: "Sam",
    dealId: "d1",
    differences: [{ label: "Out-the-door price", confirmed: "$41,200", proposed: "$42,600", consequence: "You would pay $1,400 more." }],
  });
  assert.match(r.html, /\$41,200/);
  assert.match(r.html, /\$42,600/);
  assert.match(r.text, /You would pay \$1,400 more/);
  assert.equal(/accept=|action=accept|\/accept\b/.test(r.html), false, "no one-click accept from an inbox");
});

test("the terms-locked email never claims the deal is funded", () => {
  // §12a's misunderstanding — "my financing is approved, so the car is mine" — is the one that
  // makes a buyer show up expecting to drive away.
  const r = renderFinancingTermsLocked({
    recipientName: "Sam", cash: false, approvedAmountCents: 4_500_000, aprRate: 6.4, termMonths: 60, dealId: "d1", forDealer: false,
  });
  assert.match(r.text, /not complete until the lender funds it/i);
});

test("every CTA in every Phase 7 template resolves to a route that exists", () => {
  // FOUND IN REVIEW, and it had shipped in five templates. `renderVehicleHoldExpiring`,
  // `renderFinancingPathSelected`, `renderFinancingTermsLocked`, `renderFinancingInProgress` and
  // `renderFinancingFailedOrExpired` linked `/buyer/deal/{dealId}` and
  // `/buyer/deal/{dealId}/financing`. Neither exists: `app/buyer/deal/[dealId]/` holds only
  // `complete`, `reaffirmation`, `recap` and `receipt`, and financing lives at the
  // un-parameterised `/buyer/deal/financing`. A buyer whose hold was expiring, whose terms had
  // just locked, or whose financing had failed clicked the one button in the message and got a
  // 404 — at exactly the moment the platform had asked for their attention.
  //
  // The earlier assertions here check subject, html and text, which is why none of them caught it.
  // This one resolves each path against `app/`, so the next dead CTA fails the build.
  const src = readFileSync(`${process.cwd()}/lib/services/comms/phase7-email-content.ts`, "utf8");
  const paths = [...src.matchAll(/appUrl\(`([^`]+)`\)/g)].map((m) => m[1]!);
  assert.ok(paths.length >= 10, `expected every renderer to build a CTA; found ${paths.length}`);

  const missing: string[] = [];
  for (const raw of paths) {
    // Strip the query string and turn `${input.dealId}` back into a dynamic segment.
    const clean = raw.split("?")[0]!.replace(/\$\{[^}]+\}/g, "*");
    const segments = clean.split("/").filter(Boolean);
    let dir = `${process.cwd()}/app`;
    let ok = true;
    for (const seg of segments) {
      if (seg === "*") {
        // A dynamic segment matches exactly one `[param]` directory at this level.
        const dyn = existsSync(dir) ? readdirSync(dir).find((d) => d.startsWith("[")) : undefined;
        if (!dyn) { ok = false; break; }
        dir = `${dir}/${dyn}`;
      } else {
        if (!existsSync(`${dir}/${seg}`)) { ok = false; break; }
        dir = `${dir}/${seg}`;
      }
    }
    if (!ok || !existsSync(`${dir}/page.tsx`)) missing.push(raw);
  }
  assert.deepEqual(
    missing,
    [],
    `These CTAs point at routes that do not exist — a 404 in a transactional email: ${missing.join(", ")}`,
  );
});

// AUTHORIZED SECURITY SUB-BATCH (owner-approved, Phase 6) — ONE DEALERSHIP'S OFFER WAS VISIBLE TO
// ANOTHER ON THE CONFIRMATION PAGE.
//
// THE DISCLOSURE. `/dealer-offer/[token]/confirmed` resolved the token as a `VehicleOffer` token —
// the SHARED one every invited dealership on a request receives — and rendered
// `submissions: { orderBy: { submittedAt: "desc" }, take: 1 }`: the most recent submission by ANY
// dealership. A dealership that submitted and then refreshed after a competitor submitted saw the
// competitor's NAME, OFFER PRICES, VEHICLE LISTINGS and UPLOADED DOCUMENT NAMES.
//
// It was reachable by ordinary use, not by tampering: the form was handed a per-dealer
// `inviteToken` and never read it, so EVERY dealer's redirect landed on the same shared URL.
//
// §25.1 and the dealer-isolation invariant forbid one dealership seeing another's bid, and the
// owner authorised exactly this fix — "each dealer's POST and redirect carry their own invite
// token, and the confirmed page scoped to the submission belonging to that token". Nothing else
// here widens.
//
// LIVES IN `lib/__tests__/` rather than beside the page, alongside `role-boundary-frozen` and
// `scope-guard` — the other cross-cutting authorization invariants. The route-group parentheses in
// `app/(public)/…` cannot be expressed as an unquoted path in a package.json test script, and a
// quoted one is invisible to `check-test-coverage`, so a test left there would be orphaned.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/__tests__/dealer-offer-confirmed-isolation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let invites: Rec[];
let offers: Rec[];
let inviteQueries: Rec[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleOfferDealerInvite: {
        findUnique: async (args: Rec) => {
          inviteQueries.push(args);
          const where = args.where as Rec;
          return invites.find((i) => i.token === where.token) ?? null;
        },
      },
      vehicleOffer: {
        findUnique: async ({ where }: { where: Rec }) => offers.find((o) => o.token === where.token) ?? null,
      },
    },
  },
});
mock.module("next/navigation", {
  namedExports: {
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  },
});

function submission(over: Rec = {}): Rec {
  return {
    dealershipName: "Alpha Motors",
    vehicles: [{ vehicleUrl: "https://x.test/a", year: 2023, make: "Honda", model: "Accord", offerPriceCents: 3_000_000 }],
    documents: [{ name: "alpha-buyers-order.pdf", url: "https://x.test/alpha.pdf" }],
    ...over,
  };
}

beforeEach(() => {
  invites = [
    { token: "invite_alpha", id: "inv_a", submission: submission() },
    {
      token: "invite_beta",
      id: "inv_b",
      submission: submission({
        dealershipName: "Beta Auto Group",
        vehicles: [{ vehicleUrl: "https://x.test/b", year: 2023, make: "Honda", model: "Accord", offerPriceCents: 2_850_000 }],
        documents: [{ name: "beta-worksheet.pdf", url: "https://x.test/beta.pdf" }],
      }),
    },
  ];
  offers = [{ token: "shared_offer", id: "vo_1" }];
  inviteQueries = [];
});

/** Render the server component and return its markup as a string. */
async function render(token: string): Promise<string> {
  const mod = await import("@/app/(public)/dealer-offer/[token]/confirmed/page");
  const element = await (mod.default as (p: { params: Promise<{ token: string }> }) => Promise<unknown>)({
    params: Promise.resolve({ token }),
  });
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(element as React.ReactElement);
}

// ── THE DISCLOSURE, CLOSED ──────────────────────────────────────────────────────────────────────

test("a dealership sees ITS OWN submission and nothing of a competitor's", async () => {
  const html = await render("invite_alpha");
  assert.match(html, /Alpha Motors/);
  assert.match(html, /30,000/);
  assert.match(html, /alpha-buyers-order\.pdf/);

  assert.equal(/Beta Auto Group/.test(html), false, "a competitor's dealership name was disclosed");
  assert.equal(/28,500/.test(html), false, "a competitor's OFFER PRICE was disclosed");
  assert.equal(/beta-worksheet\.pdf/.test(html), false, "a competitor's uploaded document was disclosed");
});

test("the other dealership sees only theirs, symmetrically", async () => {
  const html = await render("invite_beta");
  assert.match(html, /Beta Auto Group/);
  assert.match(html, /28,500/);
  assert.equal(/Alpha Motors/.test(html), false);
  assert.equal(/30,000/.test(html), false);
});

test("the page is scoped by the INVITE, not by recency on the shared offer", async () => {
  // The defect was `take: 1` ordered by `submitted_at desc`. The query must be keyed on the token
  // the dealership arrived with, so "who submitted most recently" cannot enter into it.
  await render("invite_alpha");
  assert.equal((inviteQueries[0].where as Rec).token, "invite_alpha");
  const json = JSON.stringify(inviteQueries[0]);
  assert.equal(/submittedAt|take/.test(json), false, "the lookup still orders or limits by recency");
});

// ── the generic shareable link ──────────────────────────────────────────────────────────────────

test("the GENERIC token names no dealership at all", async () => {
  // A shareable link carries no dealer identity, so there is no "their" submission to show — and
  // anyone holding it would otherwise see whoever submitted last. It still confirms the
  // submission; it simply cannot name it.
  const html = await render("shared_offer");
  assert.match(html, /Offer Submitted!/);
  assert.equal(/Alpha Motors|Beta Auto Group/.test(html), false, "the shared link disclosed a dealership");
  assert.equal(/30,000|28,500/.test(html), false, "the shared link disclosed an offer price");
  assert.equal(/\.pdf/.test(html), false, "the shared link disclosed a document name");
});

test("an invite whose dealership has not submitted yet is not an error", async () => {
  invites = [{ token: "invite_new", id: "inv_n", submission: null }];
  const html = await render("invite_new");
  assert.match(html, /Offer Submitted!/);
  assert.equal(/Alpha Motors/.test(html), false);
});

test("an unknown token is a 404, not an empty confirmation", async () => {
  await assert.rejects(() => render("nonsense"), /NEXT_NOT_FOUND/);
});

// Fix 4 (docs/plans/BUYER-LOCATION-GAP.md) — an unauthenticated acquisition
// route must never select or mutate a Buyer row by a phone number taken from
// the request body.
//
// /api/finder is unauthenticated, un-rate-limited and CSRF-exempt
// (frontend/proxy.ts). On its phone-capture turn it used to run
// `buyer.findFirst({ where: { phone } })` with no `orderBy` and then overwrite
// that buyer's leadScore/leadTemperature, reassign LeadScore rows, and link its
// own anonymous Conversation to the matched buyer. `buyers.phone` is
// non-unique — two phone values are each shared by multiple rows in production
// — so `findFirst` returns an arbitrary row: an anonymous caller supplying a
// known phone number could write to a different person's record.
//
// The block was deleted rather than repaired. No `orderBy` makes an anonymous
// phone string a safe key for mutating an authenticated user's record, and
// repairing it means authenticating the route — a larger change than the value
// it delivers, given the route has no in-app caller (components/acquisition/
// VehicleFinder.tsx posts to /api/concierge).
//
// This is an executable guard, not a convention: if a future edit reintroduces
// a phone-keyed Buyer lookup or mutation on this route, it fails here.
//
// Run: pnpm test:intake

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FINDER_ROUTE = "app/api/finder/route.ts";

function source(rel: string): string {
  const full = join(ROOT, rel);
  assert.ok(existsSync(full), `${rel} not found — update this guard if the route moved`);
  return readFileSync(full, "utf8");
}

test("/api/finder performs no Buyer read or write at all", async () => {
  const src = source(FINDER_ROUTE);

  // Any prisma.buyer.* access on this route is the defect: the route has no
  // authenticated principal, so it has no basis for touching a Buyer row.
  const buyerAccess = src.match(/prisma\s*\.\s*buyer\s*\.\s*\w+/g) ?? [];
  assert.deepEqual(
    buyerAccess,
    [],
    `unauthenticated route must not touch prisma.buyer — found: ${buyerAccess.join(", ")}`,
  );
});

test("/api/finder never links its anonymous conversation or scores to a buyer", async () => {
  const src = source(FINDER_ROUTE);

  // The LeadScore row is still written with buyerId: null — that is the
  // anonymous record and is fine. What must not return is back-filling a
  // buyerId onto it, or onto the Conversation, from a phone match.
  assert.equal(
    /buyerId:\s*buyer\.id/.test(src),
    false,
    "must not assign a phone-matched buyer id onto acquisition records",
  );
  assert.equal(
    /leadTemperature\s*:/.test(src),
    false,
    "must not write leadScore/leadTemperature onto a Buyer row",
  );
});

test("the anonymous lead capture still exists — MOVED, not removed", () => {
  // PHASE 2 CAPABILITY DISPOSITION: MOVED.
  //
  // /api/finder is a bodyless 410 (intake/D2 — a dead conversational finder with
  // no UI caller, neutralised in Phase 2, deletion owner-gated). §5 rule 1 says
  // every Lane 1 form posts to ONE handler, and the finder implemented its own
  // capture that produced no lead and no request — anything it caught was
  // invisible to the transaction.
  //
  // The capability it did have — anonymous conversational capture with lead
  // scoring — is not lost. It lives on the live path: /api/concierge writes a
  // BuyerOpportunity through the unified intake service, and the intake pipeline
  // scores it and records the LeadScore row. This asserts it AT ITS NEW HOME, so
  // "we moved it" stays a checkable claim rather than a note in a commit message.
  const pipeline = source("lib/services/acquisition/intake-pipeline.service.ts");
  assert.ok(/scoreLeadFromConversation/.test(pipeline), "lead scoring must remain, at its new home");
  assert.ok(/leadScore\s*\.\s*create/.test(pipeline), "the LeadScore row must still be written");

  // And the retired route must be inert: no body parsed, nothing written.
  const finder = source(FINDER_ROUTE);
  assert.ok(/status:\s*410/.test(finder), "/api/finder answers 410");
  assert.ok(!/request\.json\(/.test(finder), "the retired route parses no body");
  assert.ok(!/prisma\./.test(finder), "the retired route writes nothing");
});

test("no other unauthenticated acquisition route selects a Buyer by phone", async () => {
  // /api/concierge is the live public intake path. It writes only its own
  // session's BuyerOpportunity and reaches Buyer solely through the
  // email-keyed unified intake service — never a phone lookup.
  const concierge = source("app/api/concierge/route.ts");
  assert.equal(
    /prisma\s*\.\s*buyer\s*\.\s*(findFirst|update|updateMany)/.test(concierge),
    false,
    "/api/concierge must not select or mutate a Buyer directly",
  );
});

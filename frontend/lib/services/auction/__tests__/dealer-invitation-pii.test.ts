// Program 3 — req #14: buyer PII must NOT leak into dealer outreach beyond the
// explicitly approved business information (the buyer's CITY/STATE and the
// requested VEHICLE). The dealer invitation email + the dealer_invited lifecycle
// payload are captured here and asserted to carry no buyer name, email, phone, or
// street address — structurally, the invite path only ever selects {zip, city,
// state} from the buyer, so it cannot leak what it never reads.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/dealer-invitation-pii.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A buyer whose PII must NEVER appear in dealer outreach.
const BUYER_PII = {
  firstName: "Jasmine",
  lastName: "Okonkwo",
  email: "jasmine.okonkwo@example.com",
  phone: "+15125550199",
  streetAddress: "742 Evergreen Terrace",
};

const emailPayloads: Array<Record<string, unknown>> = [];
const lifecyclePayloads: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      featureFlag: { findUnique: async () => null }, // verification gate OFF
      auction: {
        // The buyer ROW deliberately carries full PII here (name/email/phone/address)
        // even though the service's Prisma `select` only asks for {zip, city, state}.
        // This makes the leak-guard real: if a future edit widened the select and
        // passed a PII field into the email, the row HAS that PII to leak, so the
        // assertNoBuyerPii check below would catch it. The email must still carry
        // only city/state — proving non-leakage even when PII is available upstream.
        findUnique: async () => ({
          endsAt: new Date(Date.now() + 48 * 3600_000),
          buyerId: "b1",
          buyer: {
            zip: "78701",
            city: "Austin",
            state: "TX",
            firstName: BUYER_PII.firstName,
            lastName: BUYER_PII.lastName,
            email: BUYER_PII.email,
            phone: BUYER_PII.phone,
            streetAddress: BUYER_PII.streetAddress,
          },
        }),
      },
      auctionVehicle: { findFirst: async () => ({ make: "Toyota", model: "Camry", year: 2023 }), create: async () => ({}) },
      vehicleRequest: { findFirst: async () => null },
      dealer: {
        findMany: async () => [{ id: "d1", zip: "78701", latitude: 30.2672, longitude: -97.7431 }],
        findUnique: async () => ({
          status: "ACTIVE",
          tier: "STANDARD",
          currentAuctionLoad: 0,
          scorecardSnapshots: [],
          dealershipName: "Capital Toyota",
          user: { email: "sales@capitaltoyota.com" },
        }),
        updateMany: async () => ({ count: 1 }),
      },
      auctionInvitation: { upsert: async ({ create }: { create: Record<string, unknown> }) => create },
      notification: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: { geocodeZip: async () => ({ lat: 30.2672, lng: -97.7431, source: "static" }) },
});
mock.module("@/lib/services/auction/coverage.service", {
  namedExports: { selectCoverageRadius: async () => ({ coverage: 1, registered: 1, prospects: 0, radiusMiles: 50, buyerGeocoded: true }) },
});
mock.module("@/lib/services/auction/auction-capacity.service", {
  namedExports: { getPreferredMakes: async () => [], getDealerCapacity: async () => ({}), isDealerAtCapacity: async () => false },
});
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendDealerAuctionInvitationEmail: async (p: Record<string, unknown>) => { emailPayloads.push(p); return {}; } },
});
mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: { scheduleLifecycleWorkload: async (p: Record<string, unknown>) => { lifecyclePayloads.push(p); return undefined; } },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("../dealer-invitation.service"); }

function assertNoBuyerPii(payload: unknown, where: string) {
  const blob = JSON.stringify(payload ?? {}).toLowerCase();
  for (const [field, value] of Object.entries(BUYER_PII)) {
    assert.equal(blob.includes(String(value).toLowerCase()), false, `${where} leaked buyer ${field}`);
  }
}

beforeEach(() => {
  emailPayloads.length = 0;
  lifecyclePayloads.length = 0;
});

test("dealer invitation email carries approved business info only — no buyer PII", async () => {
  const { inviteDealersToAuction } = await load();
  const count = await inviteDealersToAuction("a1", "b1");
  assert.equal(count, 1);
  assert.equal(emailPayloads.length, 1, "one dealer invitation email was sent");
  const p = emailPayloads[0]!;
  // Approved business info IS present:
  assert.equal(p.buyerCity, "Austin");
  assert.equal(p.buyerState, "TX");
  assert.equal(p.vehicleMake, "Toyota");
  // Buyer PII is NOT present anywhere in the payload:
  assertNoBuyerPii(p, "invitation email");
});

test("dealer_invited lifecycle payload carries no buyer PII (dealer email only)", async () => {
  const { inviteDealersToAuction } = await load();
  await inviteDealersToAuction("a1", "b1");
  assert.equal(lifecyclePayloads.length, 1);
  const p = lifecyclePayloads[0]!;
  assert.equal(p.workload, "dealer_invited");
  assert.equal(p.email, "sales@capitaltoyota.com", "the recipient is the DEALER, not the buyer");
  assertNoBuyerPii(p, "dealer_invited lifecycle payload");
});

// docs/transaction-flow/phase-6-proof/probe-qualified-count.ts
//
// WHY THIS EXISTS. `processAuctionClose` and `checkSLAs` both decide a branch on a FILTERED
// relation count — `_count: { select: { offers: { where: qualifiedOfferWhere() } } }`. Prisma
// accepts that shape at the type level and executes it without error; neither fact proves the
// predicate reaches the database. If it did not, the filtered count would silently equal the
// unfiltered one and every defect this phase fixed in the counting would still be live, with a
// green test suite on top of it (the unit fakes answer from memory).
//
// So it is proven against a real PostgreSQL rather than asserted. Run from `frontend/`, against a
// THROWAWAY LOOPBACK database only — the run-proof.sh carve-out, never production:
//
//   DATABASE_URL="postgresql://pgtest@127.0.0.1:55432/autolenis_chain" \
//   DIRECT_URL="postgresql://pgtest@127.0.0.1:55432/autolenis_chain" \
//     npx tsx ../docs/transaction-flow/phase-6-proof/probe-qualified-count.ts
//
// Recorded result (PostgreSQL 16.13, 2026-09-13) — see proof-run.log:
//
//   unfiltered rows on the auction : 6
//   FILTERED relation count        : 2
//   lapsedOfferWhere swept         : 1
//   qualified after the sweep      : 2
//   PASS
//
import { PrismaClient } from "@prisma/client";
import { qualifiedOfferWhere, lapsedOfferWhere } from "@/lib/services/offer/offer-validity";

const db = new PrismaClient();
const SUF = "probe6";

async function main() {
  const user = await db.user.create({
    data: { supabaseId: `probe_${SUF}`, email: `probe_${SUF}@loopback.test`, role: "BUYER" },
  });
  const buyer = await db.buyer.create({
    data: { userId: user.id, firstName: "Probe", lastName: "Six" },
  });
  const deposit = await db.deposit.create({
    data: { buyerId: buyer.id, amountCents: 9900, status: "PAID" },
  });
  const auction = await db.auction.create({
    data: { buyerId: buyer.id, depositId: deposit.id, status: "ACTIVE", endsAt: new Date("2030-01-01") },
  });
  const dealerUser = await db.user.create({
    data: { supabaseId: `probed_${SUF}`, email: `probed_${SUF}@loopback.test`, role: "DEALER" },
  });
  const dealer = await db.dealer.create({
    data: { userId: dealerUser.id, dealershipName: "Probe Motors" },
  });

  const base = {
    auctionId: auction.id, dealerId: dealer.id,
    otdPriceCents: 3_000_000, vehiclePriceCents: 2_800_000, taxCents: 150_000, feesCents: 50_000,
  };
  const FUTURE = new Date("2030-06-01");
  const PAST = new Date("2020-01-01");
  await db.offer.createMany({
    data: [
      { ...base, status: "SUBMITTED", isDisqualified: false, expiresAt: FUTURE },  // qualified
      { ...base, status: "SUBMITTED", isDisqualified: false, expiresAt: null },    // qualified (legacy)
      { ...base, status: "SUBMITTED", isDisqualified: true, expiresAt: FUTURE },   // over ceiling
      { ...base, status: "SUBMITTED", isDisqualified: false, expiresAt: PAST },    // lapsed
      { ...base, status: "WITHDRAWN", isDisqualified: false, expiresAt: FUTURE },  // superseded revision
      { ...base, status: "DRAFT", isDisqualified: false, expiresAt: FUTURE },
    ],
  });

  const [row] = await db.auction.findMany({
    where: { id: auction.id },
    select: {
      id: true,
      _count: { select: { offers: { where: qualifiedOfferWhere() } } },
      offers: { select: { id: true } },
    },
  });
  console.log("unfiltered rows on the auction :", row.offers.length);
  console.log("FILTERED relation count        :", row._count.offers);
  const swept = await db.offer.updateMany({ where: { auctionId: auction.id, ...lapsedOfferWhere() }, data: { status: "EXPIRED" } });
  console.log("lapsedOfferWhere swept          :", swept.count);
  const after = await db.offer.count({ where: { auctionId: auction.id, ...qualifiedOfferWhere() } });
  console.log("qualified after the sweep      :", after);

  const ok = row.offers.length === 6 && row._count.offers === 2 && swept.count === 1 && after === 2;
  console.log(ok ? "PASS — the predicate is applied at the database" : "FAIL");

  // Clean up: this is a throwaway loopback database, but leaving rows behind would poison the
  // next proof run's baseline.
  await db.offer.deleteMany({ where: { auctionId: auction.id } });
  await db.auction.delete({ where: { id: auction.id } });
  await db.deposit.delete({ where: { id: deposit.id } });
  await db.buyer.delete({ where: { id: buyer.id } });
  await db.dealer.delete({ where: { id: dealer.id } });
  await db.user.deleteMany({ where: { id: { in: [user.id, dealerUser.id] } } });
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error("FAILED:", e.message); await db.$disconnect(); process.exit(1); });

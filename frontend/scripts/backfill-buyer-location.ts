// Programmatic buyer-location backfill — sources ZIPs from the database rather
// than admin hand-entry. See docs/plans/BUYER-LOCATION-BACKFILL.md.
//
// DRY RUN BY DEFAULT. It reads, decides, and prints. It writes nothing unless
// --apply is passed together with --admin-email, and even then only rows whose
// value is proven to resolve through the same lookup the invitation matcher
// uses. A ZIP that does not resolve is not a backfill — it is a row that still
// invites zero dealers while looking done.
//
// Source: buyer_opportunities.zip, joined via vehicle_requests.buyer_opportunity_id.
// Corroborated — where a buyer also carries its own ZIP the two agree — and the
// corroboration is enforced in lib/services/buyer/location-backfill.ts, not
// assumed here.
//
// Writes go through updateBuyerProfileByAdmin, the same audited path the admin
// UI uses, so every row lands with an AdminAuditLog entry naming a real
// accountable admin. There is deliberately no second write path.
//
// Usage:
//   npx tsx scripts/backfill-buyer-location.ts                       # dry run
//   npx tsx scripts/backfill-buyer-location.ts --apply --admin-email you@autolenis.com

import { prisma } from "../lib/prisma";
import { decideBackfill, type BuyerRow, type BackfillDecision } from "../lib/services/buyer/location-backfill";
import { lookupZip } from "../lib/utils/zip-coords";
import { updateBuyerProfileByAdmin } from "../lib/services/admin/admin-buyer-command-center.service";

const REASON = "Buyer-location backfill from buyer_opportunities.zip — docs/plans/BUYER-LOCATION-BACKFILL.md";

interface Row extends BackfillDecision {
  resolves: boolean | null; // null when there is nothing to resolve
}

/**
 * Buyers missing any part of their location, with every opportunity ZIP
 * reachable through their vehicle requests.
 */
async function loadCandidates(): Promise<Array<{ buyer: BuyerRow; zips: Array<string | null> }>> {
  const buyers = await prisma.buyer.findMany({
    where: { OR: [{ city: null }, { state: null }, { zip: null }] },
    select: {
      id: true,
      city: true,
      state: true,
      zip: true,
      vehicleRequests: {
        where: { buyerOpportunityId: { not: null } },
        select: { buyerOpportunity: { select: { zip: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return buyers.map((b) => ({
    buyer: { id: b.id, city: b.city, state: b.state, zip: b.zip },
    zips: b.vehicleRequests.map((r) => r.buyerOpportunity?.zip ?? null),
  }));
}

function evaluate(d: BackfillDecision): Row {
  if (d.action !== "FILL" || !d.zip) return { ...d, resolves: null };
  // The gate: would `dealer-invitation.service` actually place this buyer?
  // Static tables only — GOOGLE_GEOCODING_API_KEY is unverified in production,
  // so this is the worst case and the one worth proving.
  return { ...d, resolves: lookupZip(d.zip) !== null };
}

function report(rows: Row[]): void {
  const w = Math.max(8, ...rows.map((r) => r.buyerId.length));
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("BUYER", w)}  ${pad("ACTION", 12)}  ${pad("ZIP", 7)}  ${pad("RESOLVES", 8)}  REASON`);
  for (const r of rows) {
    console.log(
      `${pad(r.buyerId, w)}  ${pad(r.action, 12)}  ${pad(r.zip ?? "—", 7)}  ` +
        `${pad(r.resolves === null ? "—" : r.resolves ? "yes" : "NO", 8)}  ${r.reason}`,
    );
  }

  const tally = rows.reduce<Record<string, number>>((a, r) => {
    a[r.action] = (a[r.action] ?? 0) + 1;
    return a;
  }, {});
  console.log("");
  console.log(
    Object.entries(tally)
      .map(([k, v]) => `${k}: ${v}`)
      .join("  ·  "),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const adminEmail = argv[argv.indexOf("--admin-email") + 1];

  const rows = (await loadCandidates()).map(({ buyer, zips }) => evaluate(decideBackfill(buyer, zips)));
  report(rows);

  const writable = rows.filter((r) => r.action === "FILL" && r.resolves === true);
  const blocked = rows.filter((r) => r.action === "FILL" && r.resolves === false);

  if (blocked.length > 0) {
    console.log("");
    console.log(`${blocked.length} row(s) have a sourced ZIP that does NOT resolve in the static table.`);
    console.log("Writing them would look like a backfill and change nothing. Add the ZIP to");
    console.log("lib/utils/zip-coords.ts or set GOOGLE_GEOCODING_API_KEY, then re-run:");
    for (const r of blocked) console.log(`  - ${r.buyerId}: ${r.zip}`);
  }

  if (!apply) {
    console.log("");
    console.log(`DRY RUN — nothing written. ${writable.length} row(s) would be updated.`);
    console.log("To apply: --apply --admin-email <your-admin-email>");
    if (blocked.length > 0) process.exitCode = 1;
    return;
  }

  if (!adminEmail || !adminEmail.includes("@")) {
    console.error("--apply requires --admin-email <address>: every write is audited to a real admin.");
    process.exitCode = 1;
    return;
  }
  if (blocked.length > 0) {
    console.error("Refusing to apply while any sourced ZIP does not resolve. Fix coverage first.");
    process.exitCode = 1;
    return;
  }

  for (const r of writable) {
    await updateBuyerProfileByAdmin(r.buyerId, `script:${adminEmail}`, adminEmail, {
      zip: r.zip!,
      reason: REASON,
    });
    console.log(`updated ${r.buyerId} -> zip ${r.zip}`);
  }
  console.log("");
  console.log(`Applied ${writable.length} row(s). Each wrote an AdminAuditLog entry.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

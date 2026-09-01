// prisma/backfill-insurance-gate.ts
//
// ONE-OFF BACKFILL — releases deals that are stranded at INSURANCE_PENDING even
// though proof of insurance is already on file.
//
// WHY THESE EXIST
// The edge INSURANCE_PENDING → CONTRACT_PENDING had no automatic driver. The admin
// repair route set insuranceStatus and advanced explicitly, but the only
// buyer-facing insurance path (POST /api/buyer/insurance/upload-proof) wrote
// insuranceStatus with a raw update and never advanced the deal. Every buyer who
// uploaded their own proof therefore stalled, invisibly, until a human noticed.
// The code path is fixed going forward; rows stranded BEFORE that fix shipped are
// still sitting there, and only a deliberate backfill moves them.
//
// WHY THIS IS A SCRIPT AND NOT A SQL UPDATE
// `deal.status` must never be written directly (autolenis-deal-lifecycle rule 1).
// Each deal is routed through advanceOnInsuranceSatisfied → advanceDealStatus, so
// the backfill inherits, rather than re-implements:
//   • the insurance gate (only INSURANCE_SATISFIED proof releases a deal),
//   • the expectedFrom from-guard (a deal a human moved mid-run is never rewound),
//   • the compare-and-swap (safe to run against live production traffic),
//   • DealStatusHistory + BuyerActivityEvent (the transition stays diagnosable),
//   • emitDealStatusComms (see CUSTOMER MESSAGING below).
// Re-running is a no-op: the driver only fires on INSURANCE_PENDING + satisfied.
//
// CUSTOMER MESSAGING — READ BEFORE --apply
// Advancing emits the normal CONTRACT_PENDING customer communication, exactly as a
// live transition would. On a backfill that means a burst of messages to every
// affected buyer at once. The dry run prints the exact number of buyers who would
// be messaged. If that number is large or the deals are old enough that the
// message would be confusing, coordinate with the owner before applying — a
// SQL-only alternative that skips comms is documented in
// prisma/migrations/manual_supabase_sql/backfill_insurance_gate.sql.
//
// USAGE (dry run by default — writes NOTHING without --apply)
//   cd frontend && npx tsx prisma/backfill-insurance-gate.ts
//   cd frontend && npx tsx prisma/backfill-insurance-gate.ts --limit 25 --apply
//   cd frontend && npx tsx prisma/backfill-insurance-gate.ts --apply
//
// Requires DATABASE_URL for the target environment. Exits non-zero if any deal
// failed to advance, so an ops runner surfaces a partial backfill.

import { PrismaClient } from "@prisma/client";
import { INSURANCE_SATISFIED, advanceOnInsuranceSatisfied } from "../lib/services/deal/deal.service";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const limitFlag = argv.indexOf("--limit");
const LIMIT = limitFlag !== -1 ? Number.parseInt(argv[limitFlag + 1] ?? "", 10) : undefined;

if (limitFlag !== -1 && (!Number.isInteger(LIMIT) || (LIMIT as number) <= 0)) {
  console.error("--limit requires a positive integer");
  process.exit(2);
}

interface Outcome {
  dealId: string;
  buyerId: string;
  insuranceStatus: string;
  result: "advanced" | "already-moved" | "failed";
  finalStatus: string;
}

async function main(): Promise<void> {
  console.log(`\n=== Insurance-gate backfill (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`Releasing: INSURANCE_PENDING + insuranceStatus IN (${INSURANCE_SATISFIED.join(", ")}) → CONTRACT_PENDING`);

  // The exact population the fixed code path would have advanced.
  const stranded = await prisma.deal.findMany({
    where: {
      status: "INSURANCE_PENDING",
      insuranceStatus: { in: INSURANCE_SATISFIED },
    },
    select: { id: true, buyerId: true, insuranceStatus: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  if (stranded.length === 0) {
    console.log("\nNothing stranded. No action needed.\n");
    return;
  }

  const oldest = stranded[0]!.createdAt;
  console.log(`\nFound ${stranded.length} stranded deal(s)${LIMIT ? ` (capped by --limit ${LIMIT})` : ""}.`);
  console.log(`Oldest was created ${oldest.toISOString()}.`);
  const byProof = stranded.reduce<Record<string, number>>((acc, d) => {
    acc[d.insuranceStatus] = (acc[d.insuranceStatus] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`By insurance proof: ${Object.entries(byProof).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`Distinct buyers who would be MESSAGED on apply: ${new Set(stranded.map((d) => d.buyerId)).size}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written and no customer messages were sent.");
    console.log("Deals that would be advanced:");
    for (const d of stranded) {
      console.log(`  ${d.id}  buyer=${d.buyerId}  proof=${d.insuranceStatus}  stranded_since=${d.updatedAt.toISOString()}`);
    }
    console.log("\nRe-run with --apply to perform the backfill.\n");
    return;
  }

  const outcomes: Outcome[] = [];
  for (const d of stranded) {
    // Routed through the real seam: CAS-guarded, from-guarded, history + comms.
    // Never throws, so one bad row cannot abort the run.
    const advanced = await advanceOnInsuranceSatisfied(d.id, { actorRole: "SYSTEM" });

    // The driver returns false both for "declined" and "failed"; re-read to tell
    // them apart so a partial backfill is visible rather than silently reported.
    const after = await prisma.deal.findUnique({ where: { id: d.id }, select: { status: true } });
    const finalStatus = after?.status ?? "UNKNOWN";
    const result: Outcome["result"] = advanced
      ? "advanced"
      : finalStatus === "INSURANCE_PENDING"
        ? "failed"
        : "already-moved";

    outcomes.push({ dealId: d.id, buyerId: d.buyerId, insuranceStatus: d.insuranceStatus, result, finalStatus });
    console.log(`  ${result.padEnd(13)} ${d.id} → ${finalStatus}`);
  }

  const advancedCount = outcomes.filter((o) => o.result === "advanced").length;
  const movedCount = outcomes.filter((o) => o.result === "already-moved").length;
  const failed = outcomes.filter((o) => o.result === "failed");

  console.log(`\n=== Result ===`);
  console.log(`advanced:      ${advancedCount}`);
  console.log(`already moved: ${movedCount} (a human or a live request got there first — expected, not an error)`);
  console.log(`failed:        ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed deals (still INSURANCE_PENDING — safe to re-run this script):");
    for (const f of failed) console.log(`  ${f.dealId}  buyer=${f.buyerId}  proof=${f.insuranceStatus}`);
    console.log("\nCheck application logs for '[deal] insurance-gate advance failed'.");
    process.exitCode = 1;
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("[backfill-insurance-gate] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

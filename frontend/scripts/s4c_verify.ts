import { prisma } from "../lib/prisma";

async function main() {
  // Find the request just created
  const recent = await prisma.vehicleRequest.findFirst({
    where: { },
    orderBy: { createdAt: "desc" },
    include: { events: true, buyerUpdates: true, offers: true, checkpoints: true },
  });
  if (!recent) { console.log("NONE"); return; }
  console.log(JSON.stringify({
    id: recent.id,
    status: recent.status,
    makePreference: recent.makePreference,
    modelPreference: recent.modelPreference,
    maxBudgetCents: recent.maxBudgetCents,
    notesPreview: (recent.notes ?? "").slice(0, 250),
    eventCount: recent.events.length,
    eventTypes: recent.events.map(e => e.eventType),
    updateCount: recent.buyerUpdates.length,
    offerCount: recent.offers.length,
  }, null, 2));

  // Count requests in last hour for this buyer (rate limit testing)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const buyerCount = await prisma.vehicleRequest.count({
    where: { buyerId: recent.buyerId, createdAt: { gte: oneHourAgo } },
  });
  console.log("buyerHourCount:", buyerCount);
}
main().then(() => process.exit(0));

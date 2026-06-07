#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { enrichDealerEmail } from "@/lib/services/dealer-recruitment/email-enrichment.service";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 500;

  console.log(`[amips-enrich-dealers] starting (force=${force}, limit=${limit})`);

  const prospects = await prisma.dealerProspect.findMany({
    where: force ? {} : { emailEnrichedAt: null },
    take: limit,
    select: { id: true, name: true, city: true, state: true, website: true },
  });

  console.log(`[amips-enrich-dealers] found ${prospects.length} prospects to enrich`);

  let enriched = 0;
  let skipped = 0;
  for (const p of prospects) {
    try {
      const res = await enrichDealerEmail({
        dealerProspectId: p.id,
        dealerName: p.name,
        city: p.city ?? "",
        state: p.state ?? "",
        website: p.website ?? null,
        force,
      });
      if (res.skipped) skipped++;
      else if (res.email) enriched++;
    } catch (err) {
      console.error(`[amips-enrich-dealers] FAILED for ${p.id}:`, err);
    }
  }

  console.log(`[amips-enrich-dealers] done — enriched ${enriched}, skipped ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

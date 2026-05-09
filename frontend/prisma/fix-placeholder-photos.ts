// Fix the 6 prior placeholder vehicles (sourceAdapter=null) that pre-existed
// before the seed_v1 run. Same Wikipedia approach.
//
// Run: cd /app/frontend && npx tsx prisma/fix-placeholder-photos.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Known prior-placeholder catalog (year+make+model => Wikipedia article slug).
const SLUGS: Record<string, string> = {
  "Toyota|Camry":            "Toyota_Camry",
  "Tesla|Model 3":           "Tesla_Model_3",
  "Ford|F-150":              "Ford_F-Series",
  "BMW|3 Series":            "BMW_3_Series",
  "Honda|Accord":            "Honda_Accord",
  "Chevrolet|Silverado 1500": "Chevrolet_Silverado",
};

const UA = "AutoLenis/1.0 (https://autolenis.com)";

async function fetchWikiHero(slug: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const d = (await r.json()) as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
  // Prefer originalimage (no /thumb/, no ORB) — fall back to thumb→original rewrite.
  const orig = d.originalimage?.source;
  if (orig) return orig;
  const thumb = d.thumbnail?.source;
  if (!thumb) return null;
  // Rewrite /thumb/<a>/<ab>/<file>/<N>px-<file> → /<a>/<ab>/<file>
  return thumb.replace(
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/thumb\/([^/]+)\/([^/]+)\/([^/]+)\/\d+px-[^/]+$/,
    "$1/$2/$3/$4",
  );
}

async function main() {
  const rows = await prisma.inventoryItem.findMany({
    where: { OR: [{ sourceAdapter: null }, { sourceAdapter: { not: "seed_v1" } }] },
    select: { id: true, make: true, model: true },
  });

  console.log(`[placeholder-fix] Found ${rows.length} placeholder rows.`);
  for (const row of rows) {
    const slug = SLUGS[`${row.make}|${row.model}`];
    if (!slug) {
      console.warn(`  ✗ No slug for ${row.make} ${row.model} — skipping`);
      continue;
    }
    const url = await fetchWikiHero(slug);
    if (!url) {
      console.warn(`  ✗ No Wiki hero for ${slug}`);
      continue;
    }
    await prisma.inventoryItem.update({
      where: { id: row.id },
      data: { images: [url] },
    });
    console.log(`  ✓ ${row.make} ${row.model} → ${url.slice(0, 100)}`);
    // Slow pace to avoid Wikipedia rate-limit
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// Retry resolver — slow & gentle, only fills in models that don't yet have a real Wiki photo.
// We detect "no real photo" by inspecting the current images[0] URL on each row.
//
// Run: cd /app/frontend && npx tsx prisma/fix-seed-photos-wiki-retry.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WIKI_SLUGS: Record<string, Record<string, string[]>> = {
  Chevrolet: {
    "Silverado 1500": ["Chevrolet_Silverado"],
    "Equinox":        ["Chevrolet_Equinox"],
    "Malibu":         ["Chevrolet_Malibu"],
    "Tahoe":          ["Chevrolet_Tahoe"],
  },
  Nissan: {
    "Rogue":    ["Nissan_Rogue"],
    "Altima":   ["Nissan_Altima"],
    "Frontier": ["Nissan_Frontier"],
  },
  Hyundai: {
    "Elantra":   ["Hyundai_Elantra"],
    "Santa Fe":  ["Hyundai_Santa_Fe"],
  },
  Kia: {
    "Sportage": ["Kia_Sportage"],
    "Sorento":  ["Kia_Sorento"],
    "Forte":    ["Kia_Forte"],
  },
  Mazda: {
    "CX-5":   ["Mazda_CX-5"],
    "Mazda3": ["Mazda3"],
  },
  Subaru: {
    "Outback":  ["Subaru_Outback"],
    "Forester": ["Subaru_Forester"],
  },
  Jeep: {
    "Grand Cherokee": ["Jeep_Grand_Cherokee"],
    "Wrangler":       ["Jeep_Wrangler"],
  },
  GMC: {
    "Sierra 1500": ["GMC_Sierra"],
    "Acadia":      ["GMC_Acadia"],
  },
  Ram: {
    "1500": ["Ram_pickup"],
  },
};

const UA = "AutoLenis/1.0 (https://autolenis.com; ops@autolenis.com)";

async function fetchWikiThumb(slug: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const data = (await r.json()) as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
  return data.originalimage?.source ?? data.thumbnail?.source ?? null;
}

function upscaleThumb(url: string, targetWidth = 1200): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${targetWidth}px-$2`);
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log("[wiki-retry] Resolving missing models slowly (1.5s/req)…");

  const photoMap = new Map<string, string>();
  for (const [make, models] of Object.entries(WIKI_SLUGS)) {
    for (const [model, slugs] of Object.entries(models)) {
      let resolved: string | null = null;
      for (const slug of slugs) {
        try {
          const raw = await fetchWikiThumb(slug);
          if (raw) {
            resolved = raw.includes("/thumb/") ? upscaleThumb(raw) : raw;
            break;
          }
        } catch (e) {
          console.warn(`  retry-needed ${slug}: ${(e as Error).message}`);
        }
        await sleep(1500);
      }
      if (resolved) {
        photoMap.set(`${make}|${model}`, resolved);
        console.log(`  ✓ ${make} ${model}`);
      } else {
        console.warn(`  ✗ ${make} ${model} — still missing`);
      }
      await sleep(1500);
    }
  }
  console.log(`[wiki-retry] Resolved ${photoMap.size}.`);

  const rows = await prisma.inventoryItem.findMany({
    where: { sourceAdapter: "seed_v1" },
    select: { id: true, make: true, model: true, images: true },
  });

  let updated = 0;
  for (const row of rows) {
    // Only update rows whose current photo is NOT already a wikimedia.org URL
    const current = row.images?.[0] ?? "";
    if (current.includes("upload.wikimedia.org")) continue;

    const url = photoMap.get(`${row.make}|${row.model}`);
    if (!url) continue;
    await prisma.inventoryItem.update({ where: { id: row.id }, data: { images: [url] } });
    updated++;
  }
  console.log(`[wiki-retry] Updated ${updated} additional rows.`);

  // Final count
  const wikiCount = await prisma.inventoryItem.count({
    where: { sourceAdapter: "seed_v1", images: { has: undefined } as never },
  });
  const total = await prisma.inventoryItem.count({ where: { sourceAdapter: "seed_v1" } });
  const stillMissing = await prisma.$queryRaw<{ make: string; model: string; n: bigint }[]>`
    SELECT make, model, COUNT(*) AS n FROM inventory_items
    WHERE source_adapter = 'seed_v1'
      AND NOT (images[1] LIKE '%upload.wikimedia.org%')
    GROUP BY make, model ORDER BY make, model
  `;
  console.log(`[wiki-retry] Total seed_v1=${total}, missing-real-photo groups:`);
  for (const r of stillMissing) console.log(`    - ${r.make} ${r.model} (${Number(r.n)})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

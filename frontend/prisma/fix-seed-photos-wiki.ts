// Re-image all seed_v1 vehicles with make/model-accurate photos from Wikipedia.
// Wikipedia REST API returns the og:image of each car-model article — these are
// real, brand-correct photos (e.g., the Honda_Accord article shows an actual Accord).
// All URLs are HTTPS, hosted on upload.wikimedia.org.
//
// Run with: cd /app/frontend && npx tsx prisma/fix-seed-photos-wiki.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Map our catalog (make + model) to a Wikipedia article slug.
// Two slugs per entry: a primary article (model-specific) and an optional
// fallback (manufacturer page) for redundancy.
const WIKI_SLUGS: Record<string, Record<string, string[]>> = {
  Toyota: {
    "RAV4":       ["Toyota_RAV4"],
    "Camry":      ["Toyota_Camry"],
    "Tacoma":     ["Toyota_Tacoma"],
    "Highlander": ["Toyota_Highlander"],
  },
  Honda: {
    "CR-V":   ["Honda_CR-V"],
    "Civic":  ["Honda_Civic"],
    "Accord": ["Honda_Accord"],
    "Pilot":  ["Honda_Pilot"],
  },
  Ford: {
    "F-150":    ["Ford_F-Series"],
    "Explorer": ["Ford_Explorer"],
    "Escape":   ["Ford_Escape"],
  },
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
    "Tucson":    ["Hyundai_Tucson"],
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
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
    // Prefer the original (highest-res) when available.
    return data.originalimage?.source ?? data.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

// Wikipedia thumbnail URLs follow the pattern
//   …/thumb/<a>/<ab>/<filename>/<N>px-<filename>
// We rewrite N to 1200 so we get a usable hero-sized image.
function upscaleThumb(url: string, targetWidth = 1200): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${targetWidth}px-$2`);
}

async function resolvePhoto(make: string, model: string): Promise<string | null> {
  const slugs = WIKI_SLUGS[make]?.[model];
  if (!slugs) {
    console.warn(`[wiki-photos] No slug mapping for ${make} ${model}`);
    return null;
  }
  for (const slug of slugs) {
    const raw = await fetchWikiThumb(slug);
    if (raw) {
      // If this is a thumb URL, upscale; if originalimage, leave as-is.
      const upscaled = raw.includes("/thumb/") ? upscaleThumb(raw) : raw;
      // Verify final URL loads
      try {
        const r = await fetch(upscaled, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
        if (r.ok) return upscaled;
      } catch {}
      // Fall back to original size if upscale 404s
      try {
        const r = await fetch(raw, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
        if (r.ok) return raw;
      } catch {}
    }
    await new Promise((res) => setTimeout(res, 250)); // rate-limit gentleness
  }
  return null;
}

async function main() {
  console.log("[wiki-photos] Resolving photo per unique (make, model)…");

  // First, build a single canonical photo per unique (make, model) pair.
  const pairs: Array<[string, string]> = [];
  for (const [make, models] of Object.entries(WIKI_SLUGS)) {
    for (const model of Object.keys(models)) pairs.push([make, model]);
  }

  const photoMap = new Map<string, string>(); // key: `${make}|${model}` → url
  for (const [make, model] of pairs) {
    const url = await resolvePhoto(make, model);
    if (url) {
      photoMap.set(`${make}|${model}`, url);
      console.log(`  ✓ ${make} ${model}`);
    } else {
      console.warn(`  ✗ ${make} ${model} — could NOT resolve a photo`);
    }
    await new Promise((res) => setTimeout(res, 350)); // ~3 req/s
  }
  console.log(`[wiki-photos] Resolved ${photoMap.size}/${pairs.length} unique photos.`);

  // Now update every seed_v1 row. Use the resolved photo as the primary image.
  const rows = await prisma.inventoryItem.findMany({
    where: { sourceAdapter: "seed_v1" },
    select: { id: true, make: true, model: true },
  });
  console.log(`[wiki-photos] Updating ${rows.length} seed_v1 rows…`);

  let updated = 0;
  let missing = 0;
  for (const row of rows) {
    const url = photoMap.get(`${row.make}|${row.model}`);
    if (!url) { missing++; continue; }
    await prisma.inventoryItem.update({
      where: { id: row.id },
      data: { images: [url] },
    });
    updated++;
  }
  console.log(`[wiki-photos] Done. updated=${updated} missing=${missing}`);

  if (missing > 0) {
    process.exit(2);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

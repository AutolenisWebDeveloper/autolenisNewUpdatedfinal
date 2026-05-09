// Convert any seed_v1 image URL that uses Wikimedia's /thumb/ path to the
// non-thumb originalimage path. Reason: /thumb/ URLs return CORP=same-origin
// which Chromium blocks via ORB (ERR_BLOCKED_BY_ORB), so the <img> doesn't render.
// The non-thumb path serves the same image without that restriction.
//
// Transform:
//   .../wikipedia/commons/thumb/<a>/<ab>/<file.jpg>/<N>px-<file.jpg>
// → .../wikipedia/commons/<a>/<ab>/<file.jpg>
//
// Run: cd /app/frontend && npx tsx prisma/fix-seed-photos-orb.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function thumbToOriginal(url: string): string {
  // /wikipedia/commons/thumb/a/ab/filename/Npx-filename → /wikipedia/commons/a/ab/filename
  const m = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/thumb\/([^/]+)\/([^/]+)\/([^/]+)\/\d+px-[^/]+$/);
  if (!m) return url;
  const [, base, a, ab, file] = m;
  return `${base}/${a}/${ab}/${file}`;
}

async function main() {
  const rows = await prisma.inventoryItem.findMany({
    select: { id: true, images: true },
  });

  let touched = 0;
  for (const row of rows) {
    const before = row.images?.[0];
    if (!before || !before.includes("/thumb/")) continue;
    const after = thumbToOriginal(before);
    if (after === before) continue;
    await prisma.inventoryItem.update({
      where: { id: row.id },
      data: { images: [after] },
    });
    touched++;
  }
  console.log(`[orb-fix] Rewrote ${touched} rows from /thumb/ to original path.`);

  // Print a few samples for sanity
  const sample = await prisma.inventoryItem.findMany({
    where: { sourceAdapter: "seed_v1" },
    select: { make: true, model: true, images: true },
    take: 6,
    orderBy: { createdAt: "desc" },
  });
  for (const s of sample) {
    console.log(`  ${s.make} ${s.model} → ${s.images[0]}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

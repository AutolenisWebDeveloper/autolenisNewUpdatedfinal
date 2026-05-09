// lib/services/faith/verse-rotation.service.ts
import { prisma } from "@/lib/prisma";
import { FAITH_VERSE_ENABLED_PAGES, FAITH_VERSE_ROTATION_WEEKS } from "@/lib/constants";

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7);
}

export async function rotateAllPages(): Promise<{ rotated: number; skipped: number }> {
  const now = new Date();
  let rotated = 0, skipped = 0;
  for (const pageKey of FAITH_VERSE_ENABLED_PAGES) {
    try {
      const recent = await prisma.versePageAssignment.findMany({ where: { pageKey }, select: { verseId: true }, orderBy: { effectiveAt: "desc" }, take: FAITH_VERSE_ROTATION_WEEKS });
      const recentIds = new Set(recent.map(a => a.verseId));
      const nextVerse = await prisma.verseLibrary.findFirst({ where: { isActive: true, id: { notIn: Array.from(recentIds) } }, orderBy: { id: "asc" } })
        ?? await prisma.verseLibrary.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } });
      if (!nextVerse) { skipped++; continue; }
      await prisma.versePageAssignment.updateMany({ where: { pageKey, isActive: true }, data: { isActive: false, expiresAt: now } });
      await prisma.versePageAssignment.create({ data: { pageKey, verseId: nextVerse.id, isActive: true, effectiveAt: now, rotationWeek: getISOWeek(now) } });
      rotated++;
    } catch { skipped++; }
  }
  return { rotated, skipped };
}

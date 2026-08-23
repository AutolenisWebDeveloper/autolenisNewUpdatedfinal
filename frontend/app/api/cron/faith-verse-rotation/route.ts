import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FAITH_VERSE_ENABLED_PAGES, FAITH_VERSE_ROTATION_WEEKS } from "@/lib/constants";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/faith-verse-rotation — Schedule: 1 6 * * 1 (Monday 12:01 AM CST)
// Rotates the NKJV verse assigned to each of the 9 enabled pages
// Never repeats a verse on the same page within 52 weeks
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("faith-verse-rotation", async () => {
  const now = new Date();
  const rotated: string[] = [];
  const skipped: string[] = [];

  for (const pageKey of FAITH_VERSE_ENABLED_PAGES) {
    try {
      // Get all verses that have been shown on this page in the last 52 weeks
      const recentAssignments = await prisma.versePageAssignment.findMany({
        where: { pageKey },
        select: { verseId: true, rotationWeek: true },
        orderBy: { effectiveAt: "desc" },
        take: FAITH_VERSE_ROTATION_WEEKS,
      });

      const recentVerseIds = new Set(recentAssignments.map(a => a.verseId));

      // Deactivate current assignment
      await prisma.versePageAssignment.updateMany({
        where: { pageKey, isActive: true },
        data: { isActive: false, expiresAt: now },
      });

      // Find a verse not shown on this page in the last 52 weeks
      const nextVerse = await prisma.verseLibrary.findFirst({
        where: {
          isActive: true,
          id: { notIn: Array.from(recentVerseIds) },
        },
        orderBy: { id: "asc" }, // Deterministic rotation
      });

      if (!nextVerse) {
        // All verses used — reset and pick the least recently shown
        const leastRecent = await prisma.verseLibrary.findFirst({
          where: { isActive: true },
          orderBy: { id: "asc" },
        });

        if (leastRecent) {
          await prisma.versePageAssignment.create({
            data: {
              pageKey,
              verseId: leastRecent.id,
              isActive: true,
              effectiveAt: now,
              rotationWeek: getISOWeek(now),
            },
          });
          rotated.push(`${pageKey}: ${leastRecent.reference} (reset)`);
        }
        continue;
      }

      // Create new assignment
      await prisma.versePageAssignment.create({
        data: {
          pageKey,
          verseId: nextVerse.id,
          isActive: true,
          effectiveAt: now,
          rotationWeek: getISOWeek(now),
        },
      });

      rotated.push(`${pageKey}: ${nextVerse.reference}`);
    } catch (err) {
      logger.error(`[faith-verse-rotation] Error for ${pageKey}:`, err);
      skipped.push(pageKey);
    }
  }

  return {
    rotated: rotated.length,
    skipped: skipped.length,
    assignments: rotated,
    executedAt: now.toISOString(),
  };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "faith-verse-rotation_failed" }, { status: 500 });

  return NextResponse.json({
    success: true,
    data: run.result,
  });
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

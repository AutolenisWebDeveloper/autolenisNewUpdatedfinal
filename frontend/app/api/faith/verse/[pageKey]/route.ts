import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ pageKey: string }> }

// GET /api/faith/verse/[pageKey] — returns current active verse for a page
// Graceful: returns null (no body error) if no verse is assigned
// System 25 — Faith & Encouragement Brand Layer
export async function GET(request: NextRequest, { params }: Props) {
  const { pageKey } = await params;

  try {
    // Get the current active assignment for this page
    const assignment = await prisma.versePageAssignment.findFirst({
      where: {
        pageKey,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: { verse: true },
      orderBy: { effectiveAt: "desc" },
    });

    if (!assignment || !assignment.verse.isActive) {
      return NextResponse.json({ success: false, data: null }, { status: 200 }); // 200, not 404 — graceful
    }

    return NextResponse.json({
      success: true,
      data: {
        reference: assignment.verse.reference,
        text: assignment.verse.text,
        translation: assignment.verse.translation,
        pageKey,
      },
    });
  } catch {
    // Graceful fallback — page never breaks if verse API fails
    return NextResponse.json({ success: false, data: null }, { status: 200 });
  }
}

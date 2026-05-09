import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ placement: string }> }

// GET /api/faith/encouragement/[placement]
// Returns encouragement message for a specific placement
// System 25 — always graceful, never breaks page layout
export async function GET(request: NextRequest, { params }: Props) {
  const { placement } = await params;

  try {
    const messages = await prisma.encouragementMessage.findMany({
      where: { placement, isActive: true },
      orderBy: { order: "asc" },
    });

    if (!messages.length) {
      return NextResponse.json({ success: false, data: null }, { status: 200 });
    }

    // Rotate through messages based on day of week
    const idx = new Date().getDay() % messages.length;
    const message = messages[idx];

    return NextResponse.json({ success: true, data: { text: message.text, placement } });
  } catch {
    return NextResponse.json({ success: false, data: null }, { status: 200 });
  }
}

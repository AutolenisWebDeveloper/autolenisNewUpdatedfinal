// Admin morning briefing API — System 16 ENH

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminJwt, ADMIN_TOKEN_COOKIE } from "@/lib/admin-auth";
import { adminBriefingAgent } from "@/lib/services/ai/agents";
import { prisma } from "@/lib/prisma";
import { isAiEnabled } from "@/lib/ai/kill-switch";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await verifyAdminJwt(token);
  if (!admin?.mfaVerified) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAiEnabled()) {
    return NextResponse.json({ success: false, error: { code: "AI_DISABLED", message: "AI kill switch is active" } }, { status: 503 });
  }

  try {
    const briefingContent = await adminBriefingAgent(admin.adminId, admin.role);

    const today = new Date().toISOString().split("T")[0];

    // Save briefing
    await prisma.adminBriefing.upsert({
      where: { id: `briefing-${today}` },
      create: { id: `briefing-${today}`, content: briefingContent, period: today },
      update: { content: briefingContent },
    }).catch(() => {
      // briefing might already exist with different ID — just create
      return prisma.adminBriefing.create({ data: { content: briefingContent, period: today } });
    });

    return NextResponse.json({ success: true, data: { briefing: briefingContent, period: today } });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "AI_ERROR", message: String(err) } }, { status: 500 });
  }
}

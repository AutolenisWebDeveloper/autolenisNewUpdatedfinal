// lib/services/admin/morning-briefing.service.ts
import { adminBriefingAgent } from "@/lib/services/ai/agents";
import { prisma } from "@/lib/prisma";

export async function generateAndSaveBriefing(adminId: string, adminRole: string): Promise<string> {
  const content = await adminBriefingAgent(adminId, adminRole);
  const period = new Date().toISOString().split("T")[0];
  await prisma.adminBriefing.upsert({
    where: { id: `briefing-${period}` },
    create: { id: `briefing-${period}`, content, period },
    update: { content },
  }).catch(() => prisma.adminBriefing.create({ data: { content, period } }));
  return content;
}

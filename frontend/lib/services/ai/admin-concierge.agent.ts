// Admin concierge agent — Zura for admins
// Higher context, platform-wide awareness, operational focus
// Groq ONLY | Kill switch required
import { groqChat, ChatMessage } from "@/lib/ai/groq-client";
import { prisma } from "@/lib/prisma";
import { buildActorGuidance, isActionIntentSurfaceEnabled } from "@/lib/services/ai/action-intent";

async function getAdminContext() {
  const [buyers, dealers, activeAuctions, pendingDeals] = await Promise.all([
    prisma.buyer.count({ where: { onboardingComplete: true } }),
    prisma.dealer.count({ where: { status: "ACTIVE" } }),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.deal.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
  ]);

  return { buyers, dealers, activeAuctions, pendingDeals };
}

function buildAdminSystemPrompt(ctx: {
  buyers: number;
  dealers: number;
  activeAuctions: number;
  pendingDeals: number;
}): string {
  return `You are Zura, AutoLenis's AI operations concierge for the admin team.

PLATFORM SNAPSHOT:
- Active buyers (onboarding complete): ${ctx.buyers}
- Active dealers: ${ctx.dealers}
- Live auctions: ${ctx.activeAuctions}
- Deals in progress: ${ctx.pendingDeals}

YOUR ROLE:
Help the AutoLenis admin team monitor platform health, prioritize operational tasks, and navigate the admin dashboard efficiently.

WHAT YOU CAN HELP WITH:
- Summarizing platform activity based on the snapshot above
- Explaining where to find specific admin actions (deals, buyers, reports)
- Guidance on compliance reviews, document verification, and operational workflows
- Identifying what actions need attention based on context
- Operational best practices for managing the AutoLenis platform

RULES:
- You have access to aggregate platform data only — never share individual PII in responses
- For security incidents, escalate to the engineering team immediately
- Always recommend human review for financial or legal decisions${
    isActionIntentSurfaceEnabled() ? `\n\n${buildActorGuidance("ADMIN")}` : ""
  }`;
}

export async function adminConciergeChat(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<{ content: string; model: string }> {
  const context = await getAdminContext();
  const systemPrompt = buildAdminSystemPrompt(context);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const result = await groqChat(messages, { maxTokens: 768, temperature: 0.5 });
  return { content: result.content, model: result.model };
}

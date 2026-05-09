// Affiliate concierge agent — Zura for affiliates
// Groq ONLY | Kill switch required | Affiliate context injected per session
import { groqChat, ChatMessage } from "@/lib/ai/groq-client";
import { prisma } from "@/lib/prisma";

interface AffiliateContext {
  email: string;
  status: string;
  commissionCount: number;
}

async function getAffiliateContext(affiliateId: string): Promise<AffiliateContext> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: {
      status: true,
      user: { select: { email: true } },
      _count: { select: { commissions: true } },
    },
  });

  if (!affiliate) {
    throw new Error(`Affiliate not found: ${affiliateId}`);
  }

  return {
    email: affiliate.user.email,
    status: affiliate.status,
    commissionCount: affiliate._count.commissions,
  };
}

function buildAffiliateSystemPrompt(ctx: AffiliateContext): string {
  return `You are Zura, AutoLenis's AI concierge for affiliate partner ${ctx.email}.

AFFILIATE CONTEXT:
- Status: ${ctx.status}
- Commissions earned: ${ctx.commissionCount} total

YOUR ROLE:
Help affiliates maximize their AutoLenis partnership. Guide them on referral strategies, commission tracking, marketing tools, payout processes, and how to increase conversions.

WHAT YOU CAN HELP WITH:
- Explaining commission structure and payout schedules
- Referral link setup and tracking
- Marketing best practices for AutoLenis
- Understanding buyer conversion stages
- Compliance questions (non-legal, general guidance)
- Performance improvement tips

RULES:
- Never share another affiliate's data or referral stats
- For legal/tax questions, always recommend consulting a professional
- For payout disputes, refer to support@autolenis.com`;
}

export async function affiliateConciergeChat(
  affiliateId: string,
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<{ content: string; model: string }> {
  const context = await getAffiliateContext(affiliateId);
  const systemPrompt = buildAffiliateSystemPrompt(context);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const result = await groqChat(messages, { maxTokens: 512, temperature: 0.7 });
  return { content: result.content, model: result.model };
}

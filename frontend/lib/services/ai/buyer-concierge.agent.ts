// Buyer concierge AI agent — System 16
// Groq API ONLY (llama-3.3-70b-versatile primary, mixtral-8x7b-32768 fallback)
// Proactive context injection from buyer's current deal state

import { groqChat, ChatMessage } from "@/lib/ai/groq-client";
import { prisma } from "@/lib/prisma";
import { ZURA_SYSTEM_PROMPT, ZURA_BUYER_CONTEXT_PREFIX } from "@/lib/ai/zura-knowledge";

interface BuyerDealContext {
  buyerName: string;
  currentStage?: string;
  maxOtdAmountCents?: number;
  activeAuction?: { id: string; status: string; endsAt?: Date };
  activeDeal?: { id: string; status: string };
  prequal?: { tier?: string; expiresAt?: Date };
}

// Build proactive context — injected at EVERY conversation start
async function getBuyerContext(buyerId: string): Promise<BuyerDealContext> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      preQualification: true,
      auctions: { where: { status: "ACTIVE" }, take: 1, orderBy: { createdAt: "desc" } },
      deals: { take: 1, orderBy: { createdAt: "desc" } },
    },
  });

  if (!buyer) return { buyerName: "Buyer" };

  const activeAuction = buyer.auctions[0];
  const activeDeal = buyer.deals[0];

  return {
    buyerName: buyer.firstName,
    maxOtdAmountCents: buyer.preQualification?.maxOtdAmountCents,
    prequal: buyer.preQualification
      ? { tier: buyer.preQualification.tier ?? undefined, expiresAt: buyer.preQualification.expiresAt }
      : undefined,
    activeAuction: activeAuction
      ? { id: activeAuction.id, status: activeAuction.status, endsAt: activeAuction.endsAt ?? undefined }
      : undefined,
    activeDeal: activeDeal ? { id: activeDeal.id, status: activeDeal.status } : undefined,
    currentStage: getStageFromContext(buyer),
  };
}

function getStageFromContext(buyer: { preQualification: unknown; auctions: unknown[]; deals: unknown[] }): string {
  if ((buyer.deals as Array<{status: string}>)[0]) return "deal-selected";
  if ((buyer.auctions as Array<{status: string}>)[0]) return "auction-active";
  if (buyer.preQualification) return "shortlist";
  return "prequal";
}

// Build system prompt with injected deal state context
function buildBuyerSystemPrompt(context: BuyerDealContext): string {
  const budgetStr = context.maxOtdAmountCents
    ? `$${(context.maxOtdAmountCents / 100).toLocaleString()}`
    : "not yet determined";

  const auctionStatus = context.activeAuction
    ? `Active — ${context.activeAuction.endsAt ? `closes ${context.activeAuction.endsAt.toLocaleDateString()}` : "in progress"}`
    : "No active auction";

  const dealStatus = context.activeDeal
    ? `In progress — stage: ${context.activeDeal.status}`
    : "No active deal";

  return `${ZURA_BUYER_CONTEXT_PREFIX}

You are speaking with ${context.buyerName}.

CURRENT BUYER CONTEXT (injected at session start — proactively reference this):
- Stage: ${context.currentStage ?? "onboarding"}
- Approved budget: ${budgetStr} (READ-ONLY — never suggest changing this)
- Prequalification tier: ${context.prequal?.tier ?? "not completed"}
- Auction: ${auctionStatus}
- Deal: ${dealStatus}

ACCOUNT-SPECIFIC RULES:
- Always reference the buyer's actual deal state above
- Never reveal dealer identities until after deal selection
- Never suggest modifying the approved budget ceiling
- Never reveal which dealers are in an active auction
- Never access or share any other buyer's information
- If asked about specific financial products (loans, APR), explain general concepts but recommend consulting a licensed professional
- Proactively offer next steps based on the buyer's current stage

${ZURA_SYSTEM_PROMPT}`;
}

// Main buyer concierge chat function
export async function buyerConciergChat(
  buyerId: string,
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<{ content: string; model: string }> {
  const context = await getBuyerContext(buyerId);
  const systemPrompt = buildBuyerSystemPrompt(context);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const result = await groqChat(messages, { maxTokens: 512, temperature: 0.7 });
  return { content: result.content, model: result.model };
}

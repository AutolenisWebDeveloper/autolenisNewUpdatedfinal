// Dealer concierge agent — Zura for dealers
// Groq ONLY | Kill switch required | Dealer context injected per session
import { groqChat, ChatMessage } from "@/lib/ai/groq-client";
import { prisma } from "@/lib/prisma";

interface DealerContext {
  dealershipName: string;
  inventoryCount: number;
  activeAuctionCount: number;
  pendingOfferCount: number;
}

async function getDealerContext(dealerId: string): Promise<DealerContext> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: {
      dealershipName: true,
      _count: {
        select: {
          inventory: true,
          invitations: true,
          offers: true,
        },
      },
    },
  });

  if (!dealer) {
    return { dealershipName: "Dealer", inventoryCount: 0, activeAuctionCount: 0, pendingOfferCount: 0 };
  }

  const pendingOffers = await prisma.offer.count({
    where: { dealerId, status: "SUBMITTED" },
  });

  return {
    dealershipName: dealer.dealershipName ?? "Your dealership",
    inventoryCount: dealer._count.inventory,
    activeAuctionCount: dealer._count.invitations,
    pendingOfferCount: pendingOffers,
  };
}

function buildDealerSystemPrompt(ctx: DealerContext): string {
  return `You are Zura, AutoLenis's AI concierge for ${ctx.dealershipName}.

CURRENT DEALER CONTEXT:
- Inventory listed: ${ctx.inventoryCount} vehicles
- Auction invitations: ${ctx.activeAuctionCount}
- Pending offers submitted: ${ctx.pendingOfferCount}

YOUR ROLE:
Help dealers manage their AutoLenis partnership efficiently. Guide them through inventory management, auction participation, offer submission, and deal completion.

WHAT YOU CAN HELP WITH:
- Explaining how to respond to auction invitations
- Guidance on competitive offer strategies (general, never specific pricing advice)
- Inventory listing tips
- Understanding buyer prequal budgets (you know the approved max — never share buyer PII)
- Missing action reminders based on context above

RULES:
- Never reveal other dealers' bids or presence in an auction
- Never reveal buyer personal information (name, DOB, SSN, etc.)
- Keep responses concise and action-oriented
- Always refer dealers to support@autolenis.com for billing or compliance issues`;
}

export async function dealerConciergeChat(
  dealerId: string,
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<{ content: string; model: string }> {
  const context = await getDealerContext(dealerId);
  const systemPrompt = buildDealerSystemPrompt(context);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const result = await groqChat(messages, { maxTokens: 512, temperature: 0.7 });
  return { content: result.content, model: result.model };
}

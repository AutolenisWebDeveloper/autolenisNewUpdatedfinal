// lib/services/ai/agents.ts — System 16 ENH: All 7 role-aware agents
// Groq API ONLY — openai/gpt-oss-120b primary, openai/gpt-oss-20b fallback
// Kill switch checked before every agent call

import { groqChat, groqChatStream, type ChatMessage } from "@/lib/ai/groq-client";
import { buildSystemPromptFromContext, buildBuyerContext, buildDealerContext, buildAdminContext, type PlatformContext } from "@/lib/ai/context-builder";
import { PREMIUM_FEE_USD } from "@/lib/constants";

// ─── Agent 1: Buyer General Concierge ─────────────────────────────────────────
export async function buyerConciergeAgent(buyerId: string, message: string, history: ChatMessage[] = []) {
  const ctx = await buildBuyerContext(buyerId);
  const system = buildSystemPromptFromContext(ctx, "You are Zura, AutoLenis's expert car-buying concierge. You guide buyers through every step of the AutoLenis process with warmth and expertise.");
  return groqChat([{ role: "system", content: system }, ...history, { role: "user", content: message }], { maxTokens: 512 });
}

// ─── Agent 2: Prequal Advisor ─────────────────────────────────────────────────
export async function prequalAdvisorAgent(buyerId: string, message: string, history: ChatMessage[] = []) {
  const ctx = await buildBuyerContext(buyerId);
  const system = buildSystemPromptFromContext(ctx, "You are AutoLenis's prequalification advisor. Help buyers understand what prequalification means, how the soft pull works, and what to expect based on their score tier. NEVER give financial advice or predict what score the buyer will receive. NEVER mention the specific dollar amounts from iPredict — those are system-only.");
  return groqChat([{ role: "system", content: system }, ...history, { role: "user", content: message }], { maxTokens: 400 });
}

// ─── Agent 3: Search & Shortlist Advisor ─────────────────────────────────────
export async function searchAdvisorAgent(buyerId: string, message: string, history: ChatMessage[] = []) {
  const ctx = await buildBuyerContext(buyerId);
  const budgetHint = ctx.prequal?.maxOtdCents ? `The buyer's approved budget is $${(ctx.prequal.maxOtdCents / 100).toLocaleString()}.` : "";
  const system = buildSystemPromptFromContext(ctx, `You are AutoLenis's vehicle search expert. Help buyers find the right vehicle, understand lane labels (Verified/Partner/Market), and build a strong shortlist. ${budgetHint} You can suggest makes, models, and features but cannot guarantee availability or pricing.`);
  return groqChat([{ role: "system", content: system }, ...history, { role: "user", content: message }], { maxTokens: 512 });
}

// ─── Agent 4: Auction Advisor ─────────────────────────────────────────────────
export async function auctionAdvisorAgent(buyerId: string, message: string, history: ChatMessage[] = []) {
  const ctx = await buildBuyerContext(buyerId);
  const system = buildSystemPromptFromContext(ctx, "You are AutoLenis's auction specialist. Explain how the 48-hour reverse auction works, what offer signals mean, and help buyers understand the Best Price Engine rankings (Cash, Monthly, Overall Value). Never reveal dealer identities during a live auction.");
  return groqChat([{ role: "system", content: system }, ...history, { role: "user", content: message }], { maxTokens: 512 });
}

// ─── Agent 5: Deal & Financing Advisor ───────────────────────────────────────
export async function dealAdvisorAgent(buyerId: string, message: string, history: ChatMessage[] = []) {
  const ctx = await buildBuyerContext(buyerId);
  const system = buildSystemPromptFromContext(ctx, `You are AutoLenis's deal completion specialist. Guide buyers through financing choice, the ${PREMIUM_FEE_USD} concierge fee, insurance, Contract Shield review, secure in-app e-signing, and QR pickup. Be precise about what each stage means and what to do next.`);
  return groqChat([{ role: "system", content: system }, ...history, { role: "user", content: message }], { maxTokens: 512 });
}

// ─── Agent 6: Dealer Performance Advisor ─────────────────────────────────────
export async function dealerAdvisorAgent(dealerId: string, message: string, history: ChatMessage[] = []) {
  const ctx = await buildDealerContext(dealerId);
  const system = buildSystemPromptFromContext(ctx, "You are AutoLenis's dealer success advisor. Help dealers improve their scorecard, understand auction mechanics, build competitive offers, and avoid junk fee flags. Reference the dealer's tier level and performance context.");
  return groqChat([{ role: "system", content: system }, ...history, { role: "user", content: message }], { maxTokens: 512 });
}

// ─── Agent 7: Admin Morning Briefing ─────────────────────────────────────────
// Generates a daily operations briefing for admin — System 16 ENH
export async function adminBriefingAgent(adminId: string, adminRole: string): Promise<string> {
  const ctx = await buildAdminContext(adminId, adminRole);

  // Build briefing context from live platform data
  const { prisma } = await import("@/lib/prisma");
  const [activeDeals, activeAuctions, pendingShield, ofacAlerts] = await Promise.all([
    prisma.deal.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } } }),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.contractScan.count({ where: { status: "FAIL" } }),
    prisma.preQualification.count({ where: { checkOfacAlert: true, decision: "OFAC_ESCALATED" } }),
  ]);

  const systemContext = buildSystemPromptFromContext(ctx, "You are AutoLenis's operations intelligence agent. Generate a concise daily briefing in 3-5 bullet points covering key operational metrics, exceptions requiring attention, and recommendations. Be direct and actionable.");

  const briefingPrompt = `Generate today's operations briefing. Platform state:
- Active deals: ${activeDeals}
- Live auctions: ${activeAuctions}
- Contract Shield fails: ${pendingShield}
- OFAC escalations: ${ofacAlerts}

Format as 3-5 prioritized bullet points with recommended actions.`;

  const result = await groqChat(
    [{ role: "system", content: systemContext }, { role: "user", content: briefingPrompt }],
    { maxTokens: 400, temperature: 0.3 }
  );

  return result.content;
}

// ─── Agent selector (routes to appropriate agent) ────────────────────────────
export type AgentType = "general" | "prequal" | "search" | "auction" | "deal" | "dealer" | "admin";

export async function routeToAgent(
  agentType: AgentType,
  entityId: string,
  message: string,
  history: ChatMessage[] = [],
  extra?: { adminRole?: string }
): Promise<{ content: string; model: string; agentType: AgentType }> {
  let result;
  switch (agentType) {
    case "prequal":  result = await prequalAdvisorAgent(entityId, message, history); break;
    case "search":   result = await searchAdvisorAgent(entityId, message, history); break;
    case "auction":  result = await auctionAdvisorAgent(entityId, message, history); break;
    case "deal":     result = await dealAdvisorAgent(entityId, message, history); break;
    case "dealer":   result = await dealerAdvisorAgent(entityId, message, history); break;
    case "general":
    default:         result = await buyerConciergeAgent(entityId, message, history); break;
  }
  return { ...result, agentType };
}

// AMIPS — AI executive narrative.
//
// Layers a natural-language executive summary on top of the deterministic
// intelligence engine. The model is given ONLY the already-computed numbers and
// is instructed to interpret them, not invent figures — keeping the engine the
// single source of truth and the narrative a faithful reading of it.

import { groqChat, type ChatMessage } from "@/lib/ai/groq-client";
import type { ExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";

const SYSTEM_PROMPT = `You are the chief market analyst for AutoLenis, an automotive market-intelligence platform. You write concise, executive-grade briefings for operators and decision-makers.

ABSOLUTE RULES:
- Use ONLY the numbers provided in the DATA payload. Never invent or estimate figures.
- Be specific and quantitative — cite the metros, vehicles, scores, and percentages from the data.
- Lead with what matters: health, the single biggest opportunity, and the most urgent risk.
- Recommend 2-3 concrete next actions tied to the data.
- Tone: sharp, confident, plain English. No marketing fluff, no hedging.
- Output 3 short labelled sections in markdown exactly: "**Bottom line**", "**Where to lean in**", "**What to watch**". Keep the whole thing under 220 words.`;

/** Build the compact data payload the model is allowed to reason over. */
function buildDataPayload(intel: ExecutiveIntelligence): string {
  return JSON.stringify(
    {
      healthIndex: intel.health.score,
      healthGrade: intel.health.grade,
      healthComponents: intel.health.components.map((c) => ({ name: c.label, score: c.value, weight: c.weight })),
      coverage: intel.coverage,
      headline: intel.headline.map((h) => ({ label: h.label, value: h.value, caption: h.caption })),
      topOpportunities: intel.opportunities.slice(0, 5).map((o) => ({
        metro: o.metro, state: o.state, opportunity: o.opportunityScore, driver: o.driver,
        demand: o.demandScore, buyerLeverage: o.buyerLeverage, dealers: o.dealers, pages: o.pages,
      })),
      topVehicles: intel.segments.slice(0, 5).map((s) => ({
        vehicle: `${s.make} ${s.model}`, buyerAdvantage: s.avgBuyerAdvantage, metros: s.metros, outlook: s.outlook,
      })),
      content: {
        activePages: intel.content.activePages,
        published30d: intel.content.published30d,
        impressions: intel.content.impressions,
        leads: intel.content.leads,
        indexationRate: Math.round(intel.content.indexationRate * 100),
        revenueRunRate: intel.headline.find((h) => h.key === "revenue")?.value ?? "n/a",
      },
      risks: intel.risks.map((r) => ({ severity: r.severity, title: r.title })),
    },
    null,
    0,
  );
}

export interface ExecutiveSummary {
  summary: string;
  model: string;
  generatedAt: string;
}

/** Generate the AI executive summary. Throws if the AI provider is unavailable. */
export async function generateExecutiveSummary(
  intel: ExecutiveIntelligence,
): Promise<ExecutiveSummary> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Write the executive briefing from this AMIPS intelligence snapshot.\n\nDATA:\n${buildDataPayload(intel)}`,
    },
  ];

  const result = await groqChat(messages, { maxTokens: 600, temperature: 0.4 });
  const summary = result.content.trim();
  if (!summary) throw new Error("Empty summary returned by AI provider");

  return { summary, model: result.model, generatedAt: new Date().toISOString() };
}

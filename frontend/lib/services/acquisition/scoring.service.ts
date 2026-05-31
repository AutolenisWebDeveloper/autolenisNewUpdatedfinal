// lib/services/acquisition/scoring.service.ts
// Combines a deterministic rule-based score (always available) with a
// Groq-driven score. The final score is the higher of the two — Groq can
// reward signal we don't encode explicitly, but the deterministic floor
// keeps high-intent leads above the "warm" threshold even if Groq is down.

import {
  type ExtractedData,
  scoreLeadWithGroq,
} from "@/lib/ai/acquisition";

export function computeDeterministicScore(data: ExtractedData): {
  score: number;
  signals: Record<string, number>;
} {
  const signals: Record<string, number> = {};

  switch (data.timeline) {
    case "this_week":
      signals.timeline = 35;
      break;
    case "1_to_3_months":
      signals.timeline = 20;
      break;
    case "researching":
      signals.timeline = 5;
      break;
    default:
      signals.timeline = 0;
  }

  const hasBudget =
    typeof data.budgetTotal === "number" ||
    typeof data.monthlyPayment === "number";
  signals.budget = hasBudget ? 20 : 5;

  if (data.make && data.model) {
    signals.vehicle = 20;
  } else if (data.make) {
    signals.vehicle = 10;
  } else {
    signals.vehicle = 3;
  }

  signals.tradeIn = data.tradeIn === true ? 10 : 0;
  signals.zip = data.zip ? 5 : 0;

  let score =
    signals.timeline +
    signals.budget +
    signals.vehicle +
    signals.tradeIn +
    signals.zip;

  // Cap at 79 if we don't have a phone — without contact info the lead is
  // unactionable regardless of intent.
  if (!data.phone) score = Math.min(score, 79);
  signals.phoneCap = data.phone ? 0 : -Math.max(0, score - 79);

  return { score: Math.max(0, Math.min(100, score)), signals };
}

export async function scoreLeadFromConversation(data: ExtractedData): Promise<{
  score: number;
  temperature: "hot" | "warm" | "cold";
  signals: Record<string, number>;
  reasoning: string;
}> {
  const deterministic = computeDeterministicScore(data);

  let aiScore = 0;
  let reasoning = "Deterministic scoring applied.";
  try {
    const ai = await scoreLeadWithGroq(data);
    aiScore = ai.score;
    if (ai.reasoning && ai.reasoning !== "AI scoring unavailable") {
      reasoning = ai.reasoning;
    }
  } catch (err) {
    console.error("[scoreLeadFromConversation] groq failed", err);
  }

  const finalScore = Math.max(deterministic.score, aiScore);
  const temperature: "hot" | "warm" | "cold" =
    finalScore >= 85 && data.phone
      ? "hot"
      : finalScore >= 50
        ? "warm"
        : "cold";

  return {
    score: finalScore,
    temperature,
    signals: deterministic.signals,
    reasoning,
  };
}

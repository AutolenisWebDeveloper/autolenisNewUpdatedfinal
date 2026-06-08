// Phase C2 — Prompt builders for the article generation engine.
//
// Turns a single ContentKeyword row (from the Phase C1 keyword database) into a
// Groq chat request that produces a GEO-optimized, compliant, national-scope
// article body + FAQ as strict JSON.
//
// National + state-aware: the spec replaces DFW-specific framing with
// "[City], [State]" / "[metro] metro" framing and passes the state's doc-fee
// rules so fee articles reference the correct cap and link the state-aware
// calculator.

import type { ChatMessage } from "@/lib/ai/groq-client";
import type { ContentKeyword } from "@/lib/seo/content-keywords";
import { PILLAR_PAGES } from "@/lib/seo/pillar-links";
import { STATE_FEE_RULES } from "@/lib/tools/dealer-fees";

export interface PillarLink {
  title: string;
  url: string;
}

// Resolve the keyword's pillar slugs to concrete {title, url} links the model
// must embed in the body.
export function resolvePillarLinks(keyword: ContentKeyword): PillarLink[] {
  return keyword.pillarSlugs
    .map((slug) => PILLAR_PAGES.find((p) => p.slug === slug))
    .filter((p): p is (typeof PILLAR_PAGES)[number] => Boolean(p))
    .map((p) => ({ title: p.title, url: p.url }));
}

function stateFeeContext(state: string): string {
  const rules = STATE_FEE_RULES[state] ?? STATE_FEE_RULES["_DEFAULT"];
  return `${rules.stateName}: ${rules.docFeeNotes}`;
}

export const SYSTEM_PROMPT = `You are the senior automotive content writer for AutoLenis, a national car-buying concierge platform. AutoLenis runs a private 48-hour reverse auction where 8 local dealers compete for one qualified buyer's business, anywhere in the United States. The founder and named author of all content is Markist.

Your job: write a single buying-guide article as STRICT JSON. The article must read like it was written by a knowledgeable insider for buyers in one specific US city, not a generic city-name swap.

NON-NEGOTIABLE COMPLIANCE RULES — violating any of these gets the article rejected:
- NEVER state a specific dollar or percentage savings amount (no "save $3,000", no "20% off MSRP").
- NEVER guarantee anything (no "guaranteed lowest price", no "we guarantee").
- NEVER use the words: guarantee, guaranteed, guarantees, promising, promise, or assured outcomes. Instead use "may help", "can help", "buyers often find", "typically", or "in many cases".
- NEVER invent testimonials, customer quotes, or star ratings.
- NEVER promise to "beat any price."
- You MAY say factual mechanics: "dealers compete for your best price", "8 dealers, 48-hour auction", real fee rules, and state fee caps stated as fact.

GEO / AI-EXTRACTION STRUCTURE (required):
- Every H2 heading is phrased as a question a buyer would ask.
- Every section opens with a direct 1-2 sentence answer, THEN expands with 150-300 words of substance.
- Write for a national audience but anchor every article in the specific city and state provided. Reference "typical market conditions in [City], [State]", "[City] dealers typically...", or "the [metro] metro area" — never claim exact local figures you cannot know.

REQUIRED SECTIONS, IN ORDER:
1. An opening <p> (no heading) — 2-3 sentences, direct and honest, naming the city and state.
2. Three to four <h2> question sections of substance (GEO structure above).
3. An <h2> titled exactly "How do competing dealer offers work without the hassle?" — explain the AutoLenis reverse auction factually (8 dealers, private 48-hour auction, buyer picks the best offer). No savings claims.

REQUIRED INLINE LINKS (embed naturally as <a href="..."> inside body paragraphs):
- Link to BOTH pillar pages provided (use the given URL and natural anchor text).
- Link to the dealer fee calculator provided at least once.

OUTPUT FORMAT — return ONLY valid minified JSON, no markdown fences, no commentary:
{"body":"<p>...</p><h2>...</h2>...","faqs":[{"question":"...","answer":"..."},... 4 to 5 items]}

BODY HTML RULES:
- Allowed tags only: <p>, <h2>, <h3>, <ul>, <li>, <ol>, <strong>, <a>.
- Do NOT include an <h1>, the author byline, or any CTA buttons — the page renders those.
- Minimum 900 words in the body (target 1,000-1,100). Do not pad with repetitive content — add depth, examples, local context, and buyer tips to reach the target length.
- FAQ answers are 2-4 sentences each, plain text (no HTML), and also follow the compliance rules.`;

export function buildUserPrompt(keyword: ContentKeyword): string {
  const pillars = resolvePillarLinks(keyword);
  const pillarLines = pillars
    .map((p) => `- "${p.title}" → ${p.url}`)
    .join("\n");
  const name =
    keyword.make && keyword.model
      ? `${keyword.make} ${keyword.model}`
      : null;

  return `Write the article for this keyword target.

CITY: ${keyword.city}
STATE: ${keyword.state}
METRO: ${keyword.metro}
CLUSTER: ${keyword.cluster}
${name ? `VEHICLE: ${name}\n` : ""}TARGET KEYWORD: ${keyword.targetKeyword}
PAGE H1 (already rendered by the page — do not repeat as a heading): ${keyword.h1}
SEARCH INTENT: ${keyword.searchIntent}

STATE FEE CONTEXT (use when fees come up; state it as fact):
${stateFeeContext(keyword.state)}

PILLAR PAGES TO LINK (embed BOTH as inline <a> links in the body):
${pillarLines}

DEALER FEE CALCULATOR TO LINK (embed at least once): ${keyword.toolUrl}

Remember: anchor everything in ${keyword.city}, ${keyword.state}; keep it compliant (no dollar/percent savings, no guarantees, no testimonials); H2s are questions; each section opens with a direct answer. Return strict JSON only.`;
}

export function buildMessages(keyword: ContentKeyword): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(keyword) },
  ];
}

// Feedback message used on a regeneration attempt when the first draft missed
// the rubric or compliance — tells the model exactly what to fix.
export function buildRetryMessage(issues: string[]): ChatMessage {
  return {
    role: "user",
    content: `Your previous draft did not pass review. Fix these issues and return corrected strict JSON only:\n${issues
      .map((i) => `- ${i}`)
      .join("\n")}\nKeep everything that was fine; only fix the listed problems.`,
  };
}

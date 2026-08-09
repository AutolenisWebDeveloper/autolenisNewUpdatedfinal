---
name: autolenis-social-content-creator
description: Produces production-ready AutoLenis social content across YouTube (+Shorts), TikTok, Instagram (+Reels), Facebook, LinkedIn, X, and Google Business Profile — long/short-form video scripts, hooks, titles, descriptions, captions, CTAs, hashtags, thumbnail concepts, shot lists, B-roll, on-screen text, carousels, static posts, polls, community posts, dealer-recruitment and buyer-education posts. Preserves AutoLenis brand voice and never fabricates prices, savings, results, dealer participation, financing outcomes, approval rates, testimonials, availability, or statistics. Orchestrates BlackTwist/Charlie Hills/Groq generators rather than duplicating them. Use when writing or generating any social content asset.
---

# AutoLenis Social Content Creator

## Purpose & authority
Generates channel-ready content. Prefer the existing generators and third-party capability skills;
this skill governs **brand voice, claim safety, and output shape**, and writes into the existing
content pipeline (`ContentQueue` → `SocialPost`), not a new store.

## Existing architecture to reuse
- Generators: `lib/social/groq-script.engine.ts` (video scripts), `carousel.generator.ts`,
  `creator-package.generator.ts`, `hook-ab-testing.engine.ts`, `hashtag-builder.ts`,
  `visual-prompt.engine.ts`, `viral-formats.ts`, `personalities.ts`, `content-quality.gate.ts`.
- Media: `image-generation.service.ts`, providers `higgsfield-image.provider.ts`,
  `runway.provider.ts`; jobs tracked in `AiMediaGeneration`. Buffer MCP / Canva / Higgsfield MCP
  may assist visual production but outputs still pass the quality gate + approval.
- AI guardrails: `autolenis-ai-safety-and-orchestration` — all LLM generation routes through the
  kill switch + structured-output validation + prompt-injection defenses.

## Supported outputs
Long-form & short-form video scripts, hooks, titles, descriptions, captions, CTAs, hashtags,
thumbnail concepts, shot lists, B-roll recommendations, on-screen text, carousel copy, static-post
copy, polls, community posts, dealer-recruitment posts, buyer-education posts, repurposed content.

## Core rules — claim safety (non-negotiable)
Never fabricate: prices · savings · customer results · dealer participation · financing outcomes ·
approval rates · testimonials · vehicle availability · market statistics. Every quantitative or
outcome claim must be substantiated (FTC substantiation); when unproven,
write educational framing ("how the process works"), not a promise. Sanitize any untrusted signal/
competitor/Reddit text before it enters a Groq prompt (SOCIAL_ENGINE_AUDIT follow-up).

## Core rules — brand & pipeline
1. Preserve AutoLenis brand voice (premium, trustworthy concierge; buyer-advocacy tone).
2. Content enters as `DRAFT`, passes `content-quality.gate.ts`, and only advances via the approval
   path in `autolenis-social-media-command-center`.
3. Attach the strategy's UTM scheme + landing page so attribution resolves.

## Prohibited behavior
Fabricating claims/testimonials/stats; bypassing the quality gate or approval; duplicating the
third-party generators' strongest capabilities instead of orchestrating them; emitting raw model
output without structured validation.

## Testing & acceptance criteria
Snapshot/contract tests for output shape per platform; claim-safety assertions (no fabricated
numbers slip through); quality-gate integration. Done = content is on-brand, substantiated, passes
the gate, and is attribution-ready.

## Cross-skill links
`autolenis-social-media-command-center` · `-content-strategy` · `-content-repurposing`;
`autolenis-ai-safety-and-orchestration` · `autolenis-integrations`.

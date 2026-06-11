// AutoLenis CRM Copilot — DRAFTING engine.
//
// Produces (a) marketing content drafts and (b) a Zod-validated automation plan
// from an admin prompt. EVERYTHING this module returns is a DRAFT requiring
// explicit human approval before it touches the templates/campaigns tables — it
// never sends, never activates, never provisions a Make scenario.
//
// Provider is Groq (llama-3.3-70b-versatile = GROQ_SUMMARY) per the platform
// mandate. Groq has no strict schema enforcement, so we run JSON Object Mode +
// Zod validation with a retry-once-then-structured-error contract: invalid model
// output is NEVER persisted.

import { z } from 'zod';
import { GROQ_SUMMARY } from '@/lib/ai/acquisition';

// The Groq model the copilot speaks to. Exported so the route can audit it
// without re-importing the acquisition lineup.
export const COPILOT_MODEL = GROQ_SUMMARY; // 'llama-3.3-70b-versatile'

// Real workflow trigger events (mirrors WorkflowTriggerType in lib/types/crm.ts)
// and the real dispatch channels. The automation plan is validated against these
// so a plan can only reference triggers/channels the platform actually has.
export const WORKFLOW_TRIGGER_TYPES = [
  'buyer_signup',
  'vehicle_request_submitted',
  'deposit_pending',
  'deposit_paid',
  'auction_started',
  'offer_received',
  'offer_selected',
  'docusign_signed',
  'purchase_completed',
  'refinance_inquiry',
  'dealer_invited',
  'affiliate_signup',
  'buyer_inactive',
  'manual',
] as const;

export const DISPATCH_CHANNELS = ['email', 'sms'] as const;

// SMS single-segment ceiling. The opt-out is included in the budget.
export const SMS_MAX_CHARS = 160;
export const SMS_OPT_OUT = 'Reply STOP to opt out.';

// ─── Zod output schemas — THE CONTRACT ──────────────────────────────────────

const EmailDraftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
});

const SmsDraftSchema = z.object({
  body: z.string().trim().min(1).max(480),
});

export const ContentDraftSchema = z.object({
  emails: z.array(EmailDraftSchema).min(1).max(5),
  sms: z.array(SmsDraftSchema).min(1).max(5),
  brief: z.string().trim().min(1).max(4000),
});

const AutomationStepSchema = z.object({
  channel: z.enum(DISPATCH_CHANNELS),
  delayHours: z.number().int().min(0).max(8760), // 0h … 1 year
  templateKey: z.string().trim().min(1).max(120),
});

export const AutomationPlanSchema = z.object({
  triggerEvent: z.enum(WORKFLOW_TRIGGER_TYPES),
  audience: z.string().trim().min(1).max(500),
  steps: z.array(AutomationStepSchema).min(1).max(20),
});

export type ContentDraft = z.infer<typeof ContentDraftSchema>;
export type AutomationPlan = z.infer<typeof AutomationPlanSchema>;
export type CopilotMode = 'content' | 'automation_plan';

// ─── Compliance guardrails (shared, verbatim, by both system prompts) ───────

export const COMPLIANCE_GUARDRAILS = `COMPLIANCE GUARDRAILS — NEVER VIOLATE:
1. NO GUARANTEES OR ABSOLUTE PROMISES. Never use the words "guarantee",
   "guaranteed", "guarantees", "promise", "promised", "assured", or any
   equivalent. Never imply guaranteed savings, guaranteed approval, or any
   guaranteed outcome — even if the user's prompt explicitly asks for one.
2. FTC SUBSTANTIATION. Make no claim you cannot substantiate. Do NOT invent
   statistics, dollar amounts, percentages, rankings, awards, or testimonials.
   When no verified figure is supplied in the prompt, speak in general,
   non-numeric terms ("many buyers", "often", "designed to help you compare").
3. NO FABRICATED STATS OR FAKE SOCIAL PROOF. Never cite studies, star ratings,
   review counts, or customer numbers that were not provided to you.
4. FINANCE & CREDIT copy must never imply guaranteed approval, a specific
   interest rate, or a specific savings amount.
5. SMS DRAFTS: keep each message at or under 160 characters INCLUDING the
   opt-out, and ALWAYS end with "Reply STOP to opt out." (TCPA). Never omit STOP.
6. EMAIL DRAFTS read as marketing copy a human will review before any send. Do
   not add unsubscribe links or a physical-address footer — the platform appends
   the CAN-SPAM footer at render time.
7. THESE ARE DRAFTS for human approval. Never state or imply the message has
   already been sent, scheduled, activated, or delivered.`;

const CONTENT_SYSTEM_PROMPT = `You are the AutoLenis CRM marketing copilot.
AutoLenis is a buyer-first automotive reverse-auction platform: qualified buyers
submit a vehicle request, up to 8 local dealers compete in a private 48-hour
auction, and the buyer picks the best offer — without walking into a dealership.

You DRAFT marketing content for a human admin to review and approve. You do not
send anything.

${COMPLIANCE_GUARDRAILS}

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no commentary:
{
  "emails": [ { "subject": "…", "body": "plain-text or light-HTML email body" } ],
  "sms": [ { "body": "SMS copy ending in 'Reply STOP to opt out.'" } ],
  "brief": "A short campaign brief: goal, audience, tone, and key message."
}
Provide 1-3 email variants and 1-2 SMS variants. Begin with { and end with }.`;

const AUTOMATION_SYSTEM_PROMPT = `You are the AutoLenis CRM automation copilot.
You DRAFT a human-buildable automation PLAN (a specification). You do NOT build,
provision, or activate anything — the plan is reviewed and built by a human.

${COMPLIANCE_GUARDRAILS}

The plan must use ONLY these real trigger events:
${WORKFLOW_TRIGGER_TYPES.join(', ')}.
Each step must use channel "email" or "sms" only, an integer delayHours (hours
after the trigger, 0 = immediate), and a templateKey (a stable snake_case handle
the human will map to a real template, e.g. "welcome_touch_1").

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no commentary:
{
  "triggerEvent": "one of the trigger events above",
  "audience": "plain-language description of who is enrolled",
  "steps": [ { "channel": "email", "delayHours": 0, "templateKey": "welcome_touch_1" } ]
}
Order steps by delayHours ascending. Begin with { and end with }.`;

// ─── Deterministic compliance post-processing (defense in depth) ────────────
//
// The system prompt is the primary guardrail. These deterministic passes are a
// belt-and-suspenders layer so a banned claim can never survive even if the
// model slips: guarantee/promise/assure families are neutralized, and every SMS
// is forced to carry the STOP opt-out.

const CLAIM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bguaranteed\s+savings\b/gi, 'potential savings'],
  [/\bguaranteed\s+approval\b/gi, 'financing options'],
  [/\bguaranteed\b/gi, 'potential'],
  [/\bguarantees\b/gi, 'aims to help'],
  [/\bguarantee\b/gi, 'help'],
  [/\bpromised\b/gi, 'described'],
  [/\bpromises\b/gi, 'aims'],
  [/\bpromise\b/gi, 'aim'],
  [/\bassured\b/gi, 'confident'],
  [/\bassures?\b/gi, 'aims to help'],
];

export function scrubProhibitedClaims(text: string): string {
  return CLAIM_REPLACEMENTS.reduce((acc, [re, repl]) => acc.replace(re, repl), text);
}

// Force the TCPA opt-out onto an SMS draft. Idempotent: if STOP is already
// present we leave the copy alone.
export function enforceSmsOptOut(body: string): string {
  const trimmed = body.trim();
  if (/\bstop\b/i.test(trimmed)) return trimmed;
  return `${trimmed} ${SMS_OPT_OUT}`.trim();
}

function applyContentCompliance(draft: ContentDraft): ContentDraft {
  return {
    emails: draft.emails.map((e) => ({
      subject: scrubProhibitedClaims(e.subject),
      body: scrubProhibitedClaims(e.body),
    })),
    sms: draft.sms.map((s) => ({
      body: enforceSmsOptOut(scrubProhibitedClaims(s.body)),
    })),
    brief: scrubProhibitedClaims(draft.brief),
  };
}

// ─── Groq call (JSON Object Mode) ───────────────────────────────────────────

export class CopilotValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.name = 'CopilotValidationError';
    this.issues = issues;
  }
}

interface GroqJsonOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

// Direct REST call to Groq's OpenAI-compatible endpoint with JSON Object Mode,
// mirroring the project's existing Groq REST pattern (lib/social/groq-script).
async function callGroqJson(opts: GroqJsonOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith('gsk_placeholder')) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: COPILOT_MODEL,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
      max_tokens: opts.maxTokens ?? 1800,
      temperature: opts.temperature ?? 0.5,
      top_p: 1.0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

// JSON Object Mode usually returns clean JSON, but strip code fences / stray
// prose defensively before parsing.
function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function parseAndValidate<T>(raw: string, schema: z.ZodType<T>): T {
  const parsed = JSON.parse(stripFences(raw)) as unknown;
  return schema.parse(parsed);
}

// Generate → validate, retrying ONCE on parse/validation failure with a
// corrective nudge. If the second attempt is still invalid we throw a
// CopilotValidationError and persist NOTHING.
async function generateValidated<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return parseAndValidate(await callGroqJson({ systemPrompt, userPrompt }), schema);
  } catch (firstErr) {
    const hint =
      `${userPrompt}\n\nYour previous response was rejected by schema validation ` +
      `(${firstErr instanceof Error ? firstErr.message.slice(0, 160) : 'invalid'}). ` +
      `Return ONLY the required JSON object, exactly matching the schema.`;
    try {
      return parseAndValidate(
        await callGroqJson({ systemPrompt, userPrompt: hint, temperature: 0.2 }),
        schema,
      );
    } catch (secondErr) {
      const issues =
        secondErr instanceof z.ZodError
          ? secondErr.errors.map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
          : [secondErr instanceof Error ? secondErr.message : String(secondErr)];
      throw new CopilotValidationError('Copilot output failed validation after retry', issues);
    }
  }
}

// ─── Public generation API ──────────────────────────────────────────────────

export async function generateContentDraft(
  prompt: string,
  context?: string,
): Promise<ContentDraft> {
  const userPrompt = context ? `${prompt}\n\nContext: ${context}` : prompt;
  const draft = await generateValidated(CONTENT_SYSTEM_PROMPT, userPrompt, ContentDraftSchema);
  // Deterministic compliance pass before the draft ever leaves the server.
  return applyContentCompliance(draft);
}

export async function generateAutomationPlan(
  prompt: string,
  context?: string,
): Promise<AutomationPlan> {
  const userPrompt = context ? `${prompt}\n\nContext: ${context}` : prompt;
  const plan = await generateValidated(
    AUTOMATION_SYSTEM_PROMPT,
    userPrompt,
    AutomationPlanSchema,
  );
  // Keep steps in execution order regardless of how the model emitted them.
  plan.steps.sort((a, b) => a.delayHours - b.delayHours);
  return plan;
}

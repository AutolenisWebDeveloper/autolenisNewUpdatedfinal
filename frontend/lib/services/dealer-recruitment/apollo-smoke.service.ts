// Apollo smoke-test diagnostic — pure logic + a single injectable-fetch call.
//
// DISPOSABLE diagnostic used ONCE to set the Apollo credit cap from a Vercel
// preview (where APOLLO_API_KEY + egress exist). It is NOT a product feature:
// it makes exactly one People Search call, persists nothing, never touches the
// ledger, never enables the tier. All decision logic is pure + unit-tested; the
// thin route (app/api/admin/apollo-smoke-test) only reads env/headers and delegates.
//
// Redaction: returns booleans + a role title + counts only — never an email,
// personal name, or the API key.

import { logger } from "@/lib/logger";

export type SmokeErrorType =
  | "bad_key"
  | "no_people_search_entitlement"
  | "no_credits"
  | "rate_limited"
  | "other";

// ── Gate 1 (prod → 404) + Gate 2 (token → 403) ───────────────────────────────

export interface SmokeGateInput {
  vercelEnv: string | undefined; // process.env.VERCEL_ENV: "production" | "preview" | "development" | undefined
  nodeEnv: string | undefined; // process.env.NODE_ENV — closes the non-Vercel prod gap
  providedToken: string | null; // x-smoke-token header or ?token=
  expectedToken: string | undefined; // process.env.SMOKE_TEST_TOKEN
}

export type GateResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Never runs in production (404). Requires a non-empty token that matches
 * SMOKE_TEST_TOKEN (403 otherwise, including when the token is not configured —
 * fail closed rather than allowing an unauthenticated call).
 *
 * Prod lockout is environment-agnostic: allowed ONLY on a Vercel preview
 * (VERCEL_ENV="preview") or a non-production build (NODE_ENV!=="production", i.e.
 * local dev). This 404s on Vercel production AND on a self-hosted production build
 * where VERCEL_ENV is unset — closing the "Vercel-only guarantee" gap.
 */
export function evaluateSmokeGates(input: SmokeGateInput): GateResult {
  const allowed = input.vercelEnv === "preview" || input.nodeEnv !== "production";
  if (!allowed) {
    return { ok: false, status: 404, body: { error: "Not found" } };
  }
  if (!input.expectedToken) {
    return { ok: false, status: 403, body: { success: false, error: "SMOKE_TEST_TOKEN is not configured in this environment" } };
  }
  if (!input.providedToken || input.providedToken !== input.expectedToken) {
    return { ok: false, status: 403, body: { success: false, error: "Forbidden — missing or invalid x-smoke-token" } };
  }
  return { ok: true };
}

// ── Apollo HTTP error classification ─────────────────────────────────────────

export function classifyApolloStatus(status: number): SmokeErrorType {
  if (status === 401) return "bad_key";
  if (status === 403) return "no_people_search_entitlement";
  if (status === 402) return "no_credits";
  if (status === 429) return "rate_limited";
  return "other";
}

// ── People Search interpretation (the economics signal) ──────────────────────

// Apollo returns a locked placeholder (e.g. "email_not_unlocked@domain.com") when
// an email exists but requires a paid reveal. A real address is none of these.
// Apollo's locked-email placeholder is "email_not_unlocked@domain.com"; match the
// placeholder token itself, not a bare "@domain.com" (which could be a real address).
const LOCKED_EMAIL_RE = /email_not_unlocked|not_unlocked@/i;
const EMAIL_STATUS_HAS_EMAIL = new Set(["verified", "likely", "extrapolated", "guessed"]);

function isRealEmail(email: unknown): boolean {
  if (typeof email !== "string" || !email) return false;
  if (LOCKED_EMAIL_RE.test(email)) return false;
  return /.+@.+\..+/.test(email);
}

export interface SearchInterpretation {
  contactFound: boolean;
  title: string | null;
  nameReturned: boolean;
  peopleCount: number;
  emailReturnedInSearch: boolean;
  emailRequiresPaidReveal: boolean;
}

/** Interpret a mixed_people/search response body into redacted diagnostic flags. */
export function interpretPeopleSearch(json: unknown): SearchInterpretation {
  const body = (json ?? {}) as { people?: Array<Record<string, unknown>> };
  const people = Array.isArray(body.people) ? body.people : [];
  const first = people[0] ?? null;
  const emailReal = isRealEmail(first?.email);
  const statusSignalsEmail =
    (typeof first?.email_status === "string" && EMAIL_STATUS_HAS_EMAIL.has(first.email_status)) ||
    first?.has_email === true;
  return {
    contactFound: !!first,
    title: (first?.title as string | undefined) ?? null,
    nameReturned: !!(first?.name),
    peopleCount: people.length,
    emailReturnedInSearch: emailReal,
    // A contact exists with an email Apollo is willing to unlock, but the free
    // search did not return the address → a paid reveal (people/match) is required.
    emailRequiresPaidReveal: !!first && !emailReal && statusSignalsEmail,
  };
}

// ── Credit balance + rate-limit header extraction ────────────────────────────

export function extractCreditAndRate(headers: Record<string, string>): {
  creditBalance: string | null;
  rateLimit: Record<string, string>;
} {
  const rateLimit: Record<string, string> = {};
  const credits: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk.includes("rate-limit") || lk.includes("ratelimit")) rateLimit[lk] = v;
    if (lk.includes("credit")) credits.push(`${lk}=${v}`);
  }
  return { creditBalance: credits.length ? credits.join("; ") : null, rateLimit };
}

// ── The single live call (injectable fetch → unit-testable) ──────────────────

export interface SmokeRunInput {
  apiKey: string;
  domain: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const APOLLO_TITLES = [
  "Internet Sales Manager",
  "Internet Sales Director",
  "BDC Manager",
  "Sales Manager",
  "General Sales Manager",
];

/**
 * ONE Apollo People Search call for `domain`, filtered to sales/BDC titles.
 * Read-only: no writes, no ledger, no reveal. Returns a redacted diagnostic
 * object (booleans + title + counts + rate/credit headers). Never throws — a
 * network/timeout failure returns { success:false, errorType:"other" }.
 */
export async function runApolloPeopleSearchSmoke(input: SmokeRunInput): Promise<Record<string, unknown>> {
  const base = (input.baseUrl ?? process.env.APOLLO_BASE_URL ?? "https://api.apollo.io/api/v1").replace(/\/$/, "");
  const doFetch = input.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), input.timeoutMs ?? 12_000);
  try {
    const res = await doFetch(`${base}/mixed_people/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": input.apiKey },
      body: JSON.stringify({
        q_organization_domains_list: [input.domain],
        person_titles: APOLLO_TITLES,
        include_similar_titles: true,
        page: 1,
        per_page: 5,
      }),
      signal: ac.signal,
    });

    const headersObj: Record<string, string> = {};
    res.headers.forEach((v, k) => { headersObj[k] = v; });
    const { creditBalance, rateLimit } = extractCreditAndRate(headersObj);

    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }

    if (!res.ok) {
      const msg =
        (json as { error?: string; message?: string } | null)?.error ??
        (json as { message?: string } | null)?.message ??
        `HTTP ${res.status}`;
      return {
        success: false,
        httpStatus: res.status,
        errorType: classifyApolloStatus(res.status),
        message: msg,
        creditBalance,
        rateLimit,
      };
    }

    const interp = interpretPeopleSearch(json);
    return {
      success: true,
      httpStatus: res.status,
      domain: input.domain,
      contactFound: interp.contactFound,
      title: interp.title,
      nameReturned: interp.nameReturned,
      peopleCount: interp.peopleCount,
      emailReturnedInSearch: interp.emailReturnedInSearch,
      emailRequiresPaidReveal: interp.emailRequiresPaidReveal,
      estimatedCreditCostPerReveal: 1,
      creditCostNote:
        "1 export credit per unlocked email (Apollo docs). People Search itself spends no credit and does not return a live balance — read the monthly credit total from Apollo dashboard → Settings → Credits and use it as the ApolloCreditLedger cap.",
      creditBalance,
      rateLimit,
    };
  } catch (err) {
    logger.warn("[apollo-smoke] people-search call failed:", err);
    return {
      success: false,
      httpStatus: 0,
      errorType: "other" as SmokeErrorType,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

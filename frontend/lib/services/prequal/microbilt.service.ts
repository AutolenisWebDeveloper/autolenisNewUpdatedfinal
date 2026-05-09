// lib/services/prequal/microbilt.service.ts
// Real MicroBilt iPredict integration — soft pull only. No hard credit pull.
// rawResponse stored AES-256-GCM encrypted at rest.
// Sandbox bypass: MICROBILT_SANDBOX=true returns hardcoded mock as the FIRST
// check (no OAuth, no network). Hard 10s AbortController timeout on the real
// call returns MANUAL_REVIEW with reason TIMEOUT. ERROR-status responses are
// logged and downgraded to MANUAL_REVIEW — never thrown to the buyer.

import { createCipheriv, randomBytes } from "crypto";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import { computeIncomeGate, type IncomeGateResult } from "./income-gate";

const ENCRYPTION_KEY = Buffer.from(
  process.env.PREQUAL_ENCRYPTION_KEY ?? "0".repeat(64),
  "hex"
);

// AES-256-GCM encryption for rawResponse
function encryptRawResponse(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// OAuth2 token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;

// Hard timeout (ms) for any single MicroBilt HTTP call
const MICROBILT_TIMEOUT_MS = 10_000;

// Fallback RequestedAmt (cents) when no income data is available — $35,000.
// Used only in the no-income path as a conservative default.
// This is NOT the final approved amount; MicroBilt validates against credit profile.
const NO_INCOME_FALLBACK_CENTS = 3_500_000;

async function getMicroBiltToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const tokenUrl = process.env.MICROBILT_OAUTH_TOKEN_URL;
  const clientId = process.env.MICROBILT_CLIENT_ID;
  const clientSecret = process.env.MICROBILT_CLIENT_SECRET;

  if (!tokenUrl || !clientId || clientId.includes("placeholder")) {
    throw new Error("MicroBilt credentials not configured");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret!,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MICROBILT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MicroBilt OAuth2 failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return cachedToken!;
}

// MM/DD/YYYY → YYYY-MM-DD for MicroBilt iPredict
export function toBirthDt(mmddyyyy: string): string {
  const [mm, dd, yyyy] = mmddyyyy.split("/");
  if (!mm || !dd || !yyyy) return mmddyyyy;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// PII required by MicroBilt iPredict. Employment fields are NEVER included.
export interface MicroBiltBuyerPII {
  firstName: string;
  lastName: string;
  dateOfBirth: string;   // MM/DD/YYYY from form
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface IPredicResult {
  decision: PreQualDecision;
  tier: PreQualTier | null;
  maxOtdAmountCents: number;
  recommendedLoanAmountCents: number | null;
  maxLoanAmountCents: number | null;
  // null indicates an indeterminate OFAC result (timeout or upstream error) —
  // callers must route to MANUAL_REVIEW rather than treating it as cleared.
  ofacFlagged: boolean | null;
  expiresAt: Date;
  rawResponse: string; // AES-256-GCM encrypted
  mocked: boolean;
  reason?: string;
}

// Sandbox / dev mock — APPROVED / GOOD / $35,000
function mockIPredict(): IPredicResult {
  return {
    decision: PreQualDecision.APPROVED,
    tier: PreQualTier.GOOD,
    maxOtdAmountCents: NO_INCOME_FALLBACK_CENTS,
    recommendedLoanAmountCents: NO_INCOME_FALLBACK_CENTS,
    maxLoanAmountCents: 4000000,
    ofacFlagged: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: encryptRawResponse(JSON.stringify({ mocked: true })),
    mocked: true,
  };
}

// Timeout / ERROR fallback — buyer routed to manual review.
// ofacFlagged is null (indeterminate) — we never reached MicroBilt's OFAC
// check, so we cannot assert the buyer is OFAC-clear. Compliance reviews
// the case manually via the MANUAL_REVIEW decision.
function timeoutResult(): IPredicResult {
  return {
    decision: PreQualDecision.MANUAL_REVIEW,
    tier: null,
    maxOtdAmountCents: 0,
    recommendedLoanAmountCents: null,
    maxLoanAmountCents: null,
    ofacFlagged: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: encryptRawResponse(JSON.stringify({ referred: true, reason: "TIMEOUT" })),
    mocked: false,
    reason: "TIMEOUT",
  };
}

function errorResult(reason: string): IPredicResult {
  return {
    decision: PreQualDecision.MANUAL_REVIEW,
    tier: null,
    maxOtdAmountCents: 0,
    recommendedLoanAmountCents: null,
    maxLoanAmountCents: null,
    ofacFlagged: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: encryptRawResponse(JSON.stringify({ referred: true, reason })),
    mocked: false,
    reason,
  };
}

// Map iPredict decision code/value to canonical decision
function mapDecision(code: string | undefined, value: string | undefined): PreQualDecision {
  const v = (value ?? code ?? "").toString().toUpperCase();
  if (v === "APPROVED" || v === "A") return PreQualDecision.APPROVED;
  if (v === "DECLINED" || v === "D") return PreQualDecision.DECLINED;
  return PreQualDecision.MANUAL_REVIEW;
}

interface CallIPredictArgs {
  buyer:              MicroBiltBuyerPII;
  monthlyIncomeCents: number | null | undefined;
  employmentStatus:   string | null | undefined;
  lengthOfEmployment: string | null | undefined;
  statedBudgetCents:  number | null | undefined;
  // legacy — kept for backward compat but no longer used as final OTD amount
  fallbackMaxOtdAmountCents?: number;
}

/**
 * Build the MicroBilt iPredict request payload. Employment fields are NEVER
 * included. Names + address fields are uppercased per MicroBilt's ingest spec.
 */
function buildPayload(buyer: MicroBiltBuyerPII, gate: IncomeGateResult) {
  return {
    MsgRqHdr: {
      RequestType: "N",
      ReasonCode:  "3",
      RefNum:      crypto.randomUUID(),
    },
    RequestedAmt: {
      // Income-derived: represents what the buyer can afford at 20% DTI/7%/72mo.
      // Not a hardcoded fallback. MicroBilt validates this against credit profile.
      Amt:     (gate.requestedAmtCents / 100).toFixed(2),
      CurCode: "USD",
    },
    PersonInfo: {
      PersonName: {
        FirstName: buyer.firstName.toUpperCase(),
        LastName:  buyer.lastName.toUpperCase(),
      },
      ContactInfo: {
        PostAddr: {
          Addr1:      buyer.address.toUpperCase(),
          City:       buyer.city.toUpperCase(),
          StateProv:  buyer.state.toUpperCase(),
          PostalCode: buyer.zip,
        },
      },
      BirthDt: toBirthDt(buyer.dateOfBirth),
    },
    // Income and employment data are NEVER sent to MicroBilt.
    // They are used only to compute RequestedAmt above (AutoLenis-internal only).
  };
}

export async function callIPredict(args: CallIPredictArgs): Promise<IPredicResult> {
  // ── Sandbox bypass ──────────────────────────────────────────────────────────
  if (process.env.MICROBILT_SANDBOX === "true") return mockIPredict();

  const reportUrl = process.env.IPREDICT_GET_REPORT_URL;
  const clientId  = process.env.MICROBILT_CLIENT_ID;
  if (!reportUrl || !clientId || clientId.includes("placeholder")) return mockIPredict();

  // ── STEP 1: Compute income gate ────────────────────────────────────────────
  const hasIncome = !!args.monthlyIncomeCents && args.monthlyIncomeCents > 0;

  let gate: IncomeGateResult;
  if (hasIncome) {
    gate = computeIncomeGate({
      monthlyIncomeCents:  args.monthlyIncomeCents!,
      employmentStatus:    args.employmentStatus ?? null,
      lengthOfEmployment:  args.lengthOfEmployment ?? null,
      statedBudgetCents:   args.statedBudgetCents ?? null,
    });
  } else {
    // No income data provided — use stated budget or conservative $35k default
    // Note: without income, we cannot validate the amount independently.
    // The result will carry reduced confidence; buyer may be asked for income.
    const fallback = args.statedBudgetCents ?? args.fallbackMaxOtdAmountCents ?? NO_INCOME_FALLBACK_CENTS;
    gate = {
      requestedAmtCents:       Math.min(fallback, 8_500_000),
      incomeBasedMaxCents:     Math.min(fallback, 8_500_000),
      stabilityFactor:         1.0,
      estimatedMonthlyPayment: 0,
      belowMinimum:            false,
    };
  }

  // If income gate signals unviable (unemployed / income too low) — decline
  if (gate.belowMinimum) {
    return {
      decision: PreQualDecision.DECLINED,
      tier:     null,
      maxOtdAmountCents:          0,
      recommendedLoanAmountCents: null,
      maxLoanAmountCents:         null,
      ofacFlagged:                false,
      expiresAt:                  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      rawResponse: encryptRawResponse(
        JSON.stringify({ declined: true, reason: "INCOME_BELOW_MINIMUM" })
      ),
      mocked: false,
      reason: "INCOME_BELOW_MINIMUM",
    };
  }

  // ── STEP 2: MicroBilt OAuth + API call ─────────────────────────────────────
  let token: string;
  try {
    token = await getMicroBiltToken();
  } catch (err) {
    console.error("[microbilt] OAuth failed:", err);
    return errorResult("OAUTH_FAILED");
  }

  const payload = buildPayload(args.buyer, gate);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MICROBILT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(reportUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return timeoutResult();
    console.error("[microbilt] iPredict network error:", err);
    return errorResult("NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[microbilt] iPredict HTTP ${res.status}: ${errBody}`);
    return errorResult(`HTTP_${res.status}`);
  }

  const raw = (await res.json().catch(() => ({}))) as IPredictResponse;

  if (raw.RESPONSE?.STATUS?.type === "ERROR") {
    console.error("[microbilt] iPredict returned ERROR:", raw.RESPONSE?.STATUS);
    return { ...errorResult("IPREDICT_ERROR"), rawResponse: encryptRawResponse(JSON.stringify(raw)) };
  }

  // ── STEP 3: Parse MicroBilt response ──────────────────────────────────────
  const content      = raw.RESPONSE?.CONTENT;
  const decisionNode = content?.DECISION;
  const idv          = content?.SERVICEDETAILS?.IDV;
  const ofac         = content?.SERVICEDETAILS?.OFAC;

  const decisionCode  = decisionNode?.decision?.code;
  const decisionValue = decisionNode?.decision?.Value;

  // Parse loan amounts — check all possible field names iPredict may return
  const recommendedLoanAmountCents =
    decisionNode?.recommendedLoanAmount
      ? Math.round(parseFloat(decisionNode.recommendedLoanAmount) * 100)
    : decisionNode?.approvedAmount
      ? Math.round(parseFloat(decisionNode.approvedAmount) * 100)
    : decisionNode?.qualifiedAmount
      ? Math.round(parseFloat(decisionNode.qualifiedAmount) * 100)
    : null;

  const maxLoanAmountCents =
    decisionNode?.maxLoanAmount
      ? Math.round(parseFloat(decisionNode.maxLoanAmount) * 100)
    : decisionNode?.maxApprovedAmount
      ? Math.round(parseFloat(decisionNode.maxApprovedAmount) * 100)
    : null;

  const ofacFlagged = idv?.OFACAlert === "Y" || ofac?.ofacresult === "Y";
  const decision    = mapDecision(decisionCode, decisionValue);

  // ── STEP 4: Two-gate minimum — income gate vs credit gate ─────────────────
  // Final OTD = min(income-computed max, MicroBilt-approved amount)
  // This is the same logic used by all major auto lenders.
  const creditGateAmount = recommendedLoanAmountCents ?? maxLoanAmountCents ?? null;

  let finalDecision     = decision;
  let maxOtdAmountCents = 0;

  if (decision === PreQualDecision.APPROVED) {
    if (creditGateAmount !== null && creditGateAmount > 0) {
      if (hasIncome) {
        // Both gates have data: take the conservative minimum
        maxOtdAmountCents = Math.min(gate.incomeBasedMaxCents, creditGateAmount);
      } else {
        // No income validation: use credit gate only (less accurate)
        maxOtdAmountCents = creditGateAmount;
      }
    } else {
      // MicroBilt approved but returned no amount — cannot issue reliable budget
      finalDecision     = PreQualDecision.MANUAL_REVIEW;
      maxOtdAmountCents = 0;
      console.warn("[microbilt] APPROVED with no loan amount — routing to MANUAL_REVIEW");
    }
  }

  // ── STEP 5: Derive tier ────────────────────────────────────────────────────
  const tier = finalDecision === PreQualDecision.APPROVED && maxOtdAmountCents > 0
    ? deriveTier(maxOtdAmountCents, gate.requestedAmtCents, args.monthlyIncomeCents ?? null)
    : null;

  return {
    decision:                   finalDecision,
    tier,
    maxOtdAmountCents,
    recommendedLoanAmountCents,
    maxLoanAmountCents,
    ofacFlagged,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: encryptRawResponse(JSON.stringify(raw)),
    mocked: false,
  };
}

// Tier derivation — mirrors Capital One / Chase / credit union tier bands
function deriveTier(
  approvedCents:      number,
  requestedCents:     number,
  monthlyIncomeCents: number | null,
): PreQualTier {
  const approvalRatio = requestedCents > 0
    ? approvedCents / requestedCents
    : 0;

  // Payment-to-income ratio at benchmark rate
  const PAYMENT_FACTOR_TIER = (() => {
    const r = 0.07 / 12;
    return (r * Math.pow(1 + r, 72)) / (Math.pow(1 + r, 72) - 1);
  })();

  const monthlyPayment  = (approvedCents / 100) * PAYMENT_FACTOR_TIER;
  const paymentToIncome = monthlyIncomeCents && monthlyIncomeCents > 0
    ? monthlyPayment / (monthlyIncomeCents / 100)
    : null;

  // Tier classification:
  //   STRONG:  credit approved ≥90% of requested AND payment ≤10% of income
  //   GOOD:    credit approved ≥70% AND payment ≤14% of income
  //   FAIR:    credit approved ≥50% AND payment ≤19% of income
  //   WEAK:    approved but near or at DTI limit
  if (paymentToIncome !== null) {
    if (approvalRatio >= 0.90 && paymentToIncome <= 0.10) return PreQualTier.STRONG;
    if (approvalRatio >= 0.70 && paymentToIncome <= 0.14) return PreQualTier.GOOD;
    if (approvalRatio >= 0.50 && paymentToIncome <= 0.19) return PreQualTier.FAIR;
    return PreQualTier.WEAK;
  }

  // No income: use approval ratio only
  if (approvalRatio >= 0.90) return PreQualTier.STRONG;
  if (approvalRatio >= 0.70) return PreQualTier.GOOD;
  if (approvalRatio >= 0.50) return PreQualTier.FAIR;
  return PreQualTier.WEAK;
}

// FCRA adverse-action language — LEGALLY REQUIRED on every DECLINED page
export const FCRA_ADVERSE_ACTION_LANGUAGE = `
ADVERSE ACTION NOTICE — FAIR CREDIT REPORTING ACT (FCRA)

Your prequalification application has not been approved. This decision was based in whole or in part on information obtained from a consumer reporting agency.

Consumer Reporting Agency Used:
MicroBilt Corporation
1-888-217-5866
www.microbilt.com

Under the Fair Credit Reporting Act, you have the right to:
• Obtain a free copy of your consumer report from MicroBilt within 60 days
• Dispute any inaccurate information in the report
• Add a statement to your file explaining any adverse information

The agency did not make this decision and cannot explain the specific reasons for it. For more information about your FCRA rights, visit www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/.
`.trim();

// Verbatim FCRA consent text — must NEVER be paraphrased, shortened, or reworded.
// Stored on PrequalConsent.consentText to preserve a legal audit trail.
export const FCRA_CONSENT_TEXT =
  'I understand that by clicking on the I AGREE button immediately following this notice, I am providing "written instructions" to AutoLenis under the Fair Credit Reporting Act authorizing AutoLenis to obtain information from my personal credit profile or other information from MicroBilt. I authorize AutoLenis to obtain such information solely to prequalify me for credit options. Credit Information accessed for my pre-qualification request may be different than the Credit Information accessed by a credit grantor on a date after the date of my original pre-qualification request to make the credit decision.';

// ─── Response shape (subset we read) ────────────────────────────────────────
interface IPredictResponse {
  RESPONSE?: {
    STATUS?:  { type?: string; message?: string };
    CONTENT?: {
      DECISION?: {
        decision?: { code?: string; Value?: string };
        recommendedLoanAmount?: string;
        maxLoanAmount?:         string;
        approvedAmount?:        string;   // alternative field name
        qualifiedAmount?:       string;   // alternative field name
        maxApprovedAmount?:     string;   // alternative field name
        reasonCodes?:           string[]; // adverse action codes
      };
      SERVICEDETAILS?: {
        IDV?:  { OFACAlert?: string };
        OFAC?: { ofacresult?: string };
      };
    };
  };
}

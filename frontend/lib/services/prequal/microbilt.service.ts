// lib/services/prequal/microbilt.service.ts
// Real MicroBilt iPredict integration — soft pull only. No hard credit pull.
// rawResponse stored AES-256-GCM encrypted at rest.
// Sandbox bypass: MICROBILT_SANDBOX=true returns hardcoded mock as the FIRST
// check (no OAuth, no network). Hard 10s AbortController timeout on the real
// call returns MANUAL_REVIEW with reason TIMEOUT. ERROR-status responses are
// logged and downgraded to MANUAL_REVIEW — never thrown to the buyer.

import { logger } from "@/lib/logger";
import { createCipheriv, randomBytes } from "crypto";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  computeIncomeGate,
  getBenchmarkApr,
  type BenchmarkTier,
  type IncomeGateResult,
} from "./income-gate";

// AES-256-GCM key for encrypting consumer-report rawResponse at rest.
// Fail-fast: there is NO default. A missing or malformed key must never
// silently degrade to a known/guessable key (which would make "encrypted"
// reports trivially decryptable). Validated lazily on first use — never at
// import time — so `next build` static analysis is not broken by a throw.
// Mirrors the check in scripts/decrypt-prequal-error.ts (64-char hex).
let cachedEncryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey) return cachedEncryptionKey;
  const keyHex = process.env.PREQUAL_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      "PREQUAL_ENCRYPTION_KEY is missing or not a 64-character hex string " +
        "(required 32-byte AES-256-GCM key). Refusing to encrypt prequal data " +
        "with an insecure fallback key."
    );
  }
  cachedEncryptionKey = Buffer.from(keyHex, "hex");
  return cachedEncryptionKey;
}

// ─── iPredict Advantage URL resolvers (iPredict_6.yaml spec) ────────────────────
// Production:  https://api.microbilt.com/iPredict  · POST /GetReport
// Sandbox:     https://apitest.microbilt.com/iPredict
// OAuth lives on a SEPARATE path (NOT under /iPredict): /OAuth/Token
// New *_BASE_URL / *_SANDBOX_URL env vars must include the full /GetReport (or
// /OAuth/Token) suffix. Legacy vars are kept as fallback for backward compat.

function isSandboxMode(): boolean {
  return process.env.MICROBILT_SANDBOX === "true";
}

function getReportUrl(): string | null {
  // Spec endpoint: POST /GetReport — env vars must include the /GetReport suffix.
  return (
    (isSandboxMode()
      ? process.env.MICROBILT_SANDBOX_URL
      : process.env.MICROBILT_BASE_URL) ??
    process.env.IPREDICT_GET_REPORT_URL ??
    null
  );
}

function getOAuthUrl(): string | null {
  return (
    (isSandboxMode()
      ? process.env.MICROBILT_OAUTH_SANDBOX_URL
      : process.env.MICROBILT_OAUTH_BASE_URL) ??
    process.env.MICROBILT_OAUTH_TOKEN_URL ??
    null
  );
}

/**
 * Non-secret MicroBilt configuration snapshot for the admin system-health page.
 * Never returns client secret or token — only URLs, product, CAID, and a
 * boolean indicating whether credentials are present.
 */
export function getMicroBiltConfigStatus() {
  const clientId = process.env.MICROBILT_CLIENT_ID;
  return {
    mode: isSandboxMode() ? ("SANDBOX" as const) : ("PRODUCTION" as const),
    reportUrl: getReportUrl(),
    oauthUrl: getOAuthUrl(),
    product: process.env.MICROBILT_PRODUCT ?? "IPredict Advantage",
    caid: process.env.MICROBILT_CAID ?? null,
    credentialsPresent: !!(
      clientId &&
      process.env.MICROBILT_CLIENT_SECRET &&
      !clientId.includes("placeholder")
    ),
  };
}

// AES-256-GCM encryption for rawResponse
function encryptRawResponse(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
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

  const tokenUrl = getOAuthUrl();
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
  // ── Decision detail (institutional-grade transparency / storage) ──────────
  // Actual DTI ratios for this buyer, basis points (1850 = 18.50%).
  frontEndDtiBps?: number | null;
  backEndDtiBps?: number | null;
  // Benchmark APR used in the FINAL (tier-aware) calculation, bps (1050 = 10.5%).
  benchmarkAprBps?: number | null;
  // Existing housing + other-debt obligations used in the back-end DTI (cents).
  totalMonthlyObligationsCents?: number | null;
  // Monthly income after the employment stability haircut (cents).
  effectiveIncomeCents?: number | null;
  // ── iPredict_6.yaml spec fields (SCORES / REASONS / IDV / MLA) ─────────────
  creditScore: number | null;          // DECISION.SCORES[0].Value (300–850)
  idvScore: number | null;             // SERVICEDETAILS.IDV.score
  mlaCovered: boolean | null;          // Military Lending Act covered borrower
  fraudWarning: string | null;         // SERVICEDETAILS.IDV.fraudWarning
  adverseReasonCodes: string[];        // DECISION.REASONS[].code (FCRA § 615)
  deceasedFlag: boolean;               // SERVICEDETAILS.IDV.deceasedIndicator
  bankruptcyFlag: boolean;             // SERVICEDETAILS.IDV.bankruptcyFlag
  highRiskAddressFlag: boolean;        // IDV.highRiskAddress / suspiciousAddress
}

// Risk fields for paths where iPredict was never reached or returned no data.
// mlaCovered/null is indeterminate (we cannot assert non-coverage).
const INDETERMINATE_RISK = {
  creditScore: null,
  idvScore: null,
  mlaCovered: null,
  fraudWarning: null,
  adverseReasonCodes: [] as string[],
  deceasedFlag: false,
  bankruptcyFlag: false,
  highRiskAddressFlag: false,
} satisfies Pick<
  IPredicResult,
  | "creditScore"
  | "idvScore"
  | "mlaCovered"
  | "fraudWarning"
  | "adverseReasonCodes"
  | "deceasedFlag"
  | "bankruptcyFlag"
  | "highRiskAddressFlag"
>;

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
    ...INDETERMINATE_RISK,
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
    ...INDETERMINATE_RISK,
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
    ...INDETERMINATE_RISK,
  };
}

// Tri-state OFAC screening result. Returns:
//   true  — a sanctions hit (either signal is exactly "Y")
//   false — screening ran and AFFIRMATIVELY cleared (a signal is exactly "N")
//   null  — indeterminate: no signal returned, OR a signal we do not recognize
//           as either a hit or a clear (e.g. "HIT" / "R" / "P" / "1" / "")
// Fail-closed: we only assert "cleared" on an explicit "N". Any other present
// value is treated as indeterminate (→ manual review) rather than a clear, so an
// unexpected provider token can never flow through to an approval. A "Y" on
// either signal is always a hit even if the other says "N".
export function computeOfacFlag(
  idvAlert: string | undefined | null,
  ofacResult: string | undefined | null,
): boolean | null {
  const idvUp = idvAlert?.trim().toUpperCase();
  const ofacUp = ofacResult?.trim().toUpperCase();
  // A hit on either signal wins outright.
  if (idvUp === "Y" || ofacUp === "Y") return true;
  // Of the signals actually returned, clear ONLY if EVERY one is an explicit
  // "N". No signal at all, or any unrecognized token (even alongside an "N"),
  // is indeterminate → manual review.
  const present = [idvUp, ofacUp].filter((v): v is string => v !== undefined && v !== "");
  if (present.length > 0 && present.every((v) => v === "N")) return false;
  return null;
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
  // Back-end DTI inputs — AutoLenis-internal only, never sent to MicroBilt.
  monthlyHousingPaymentCents?: number | null;
  monthlyOtherDebtCents?:      number | null;
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
  // Mock output requires an EXPLICIT opt-in via MICROBILT_SANDBOX=true. We
  // never fall back to mock APPROVED on misconfiguration — that would turn a
  // production env mistake into silent fake approvals. When credentials are
  // missing/placeholder outside sandbox mode we route to MANUAL_REVIEW
  // (CONFIG_ERROR) so a human can fix the deployment.
  if (isSandboxMode()) return mockIPredict();

  const reportUrl = getReportUrl();
  const oauthUrl  = getOAuthUrl();
  const clientId  = process.env.MICROBILT_CLIENT_ID;

  // ── Production URL safety guards (iPredict_6.yaml cutover) ──────────────────
  // Sandbox mode already returned above, so we are in production here. Refuse to
  // call apitest. with production credentials, and require both URLs.
  if (!isSandboxMode()) {
    if (reportUrl?.includes("apitest.")) {
      logger.error(
        "[microbilt] CRITICAL: production mode but report URL points to " +
        "apitest. Routing to MANUAL_REVIEW."
      );
      return errorResult("CONFIG_MISMATCH");
    }
    if (oauthUrl?.includes("apitest.")) {
      logger.error(
        "[microbilt] CRITICAL: production mode but OAuth URL points to " +
        "apitest. Routing to MANUAL_REVIEW."
      );
      return errorResult("CONFIG_MISMATCH");
    }
    if (!reportUrl?.endsWith("/GetReport")) {
      logger.warn(
        "[microbilt] WARNING: report URL does not end with /GetReport — " +
        "verify configuration against spec."
      );
    }
    if (!reportUrl || !oauthUrl) {
      logger.error(
        "[microbilt] CRITICAL: missing production URLs. reportUrl=" +
        !!reportUrl + " oauthUrl=" + !!oauthUrl
      );
      return errorResult("URL_NOT_CONFIGURED");
    }
  }

  if (!reportUrl || !clientId || clientId.includes("placeholder")) {
    logger.error(
      "[microbilt] CONFIG_ERROR: MICROBILT_CLIENT_ID or the iPredict report URL " +
      "is missing or contains a placeholder, and MICROBILT_SANDBOX is not 'true'. " +
      "Routing prequalification to MANUAL_REVIEW until deployment env is fixed.",
    );
    return errorResult("CONFIG_ERROR");
  }

  // ── STEP 1: Compute income gate (PASS 1 — UNKNOWN tier, 10.5% APR) ─────────
  // PASS 1 sizes the RequestedAmt sent to iPredict using a conservative middle-
  // ground APR. After MicroBilt returns and a tier is derived, we RE-RUN the
  // gate with the tier-specific APR for an accurate final estimate (PASS 2).
  const hasIncome = !!args.monthlyIncomeCents && args.monthlyIncomeCents > 0;

  // Shared income-gate inputs (reused for PASS 2 with the derived tier).
  const incomeGateBase = {
    monthlyIncomeCents:         args.monthlyIncomeCents ?? 0,
    employmentStatus:           args.employmentStatus ?? null,
    lengthOfEmployment:         args.lengthOfEmployment ?? null,
    statedBudgetCents:          args.statedBudgetCents ?? null,
    monthlyHousingPaymentCents: args.monthlyHousingPaymentCents ?? null,
    monthlyOtherDebtCents:      args.monthlyOtherDebtCents ?? null,
  };

  let gate: IncomeGateResult;
  if (hasIncome) {
    gate = computeIncomeGate({ ...incomeGateBase, benchmarkTier: "UNKNOWN" });
  } else {
    // No income data provided — use stated budget or conservative $35k default
    // Note: without income, we cannot validate the amount independently.
    // The result will carry reduced confidence; buyer may be asked for income.
    const fallback = args.statedBudgetCents ?? args.fallbackMaxOtdAmountCents ?? NO_INCOME_FALLBACK_CENTS;
    gate = {
      requestedAmtCents:            Math.min(fallback, 8_500_000),
      incomeBasedMaxCents:          Math.min(fallback, 8_500_000),
      stabilityFactor:              1.0,
      effectiveIncomeCents:         0,
      estimatedMonthlyPayment:      0,
      belowMinimum:                 false,
      frontEndDtiBps:               0,
      backEndDtiBps:                0,
      totalMonthlyObligationsCents: 0,
      benchmarkAprBps:              Math.round(getBenchmarkApr("UNKNOWN") * 10000),
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
      // OFAC was NEVER screened here — the income gate declined before the
      // MicroBilt call. null (indeterminate) honors the tri-state contract; we
      // must not assert "screened & cleared" for a bureau call that never ran.
      ofacFlagged:                null,
      expiresAt:                  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      rawResponse: encryptRawResponse(
        JSON.stringify({ declined: true, reason: "INCOME_BELOW_MINIMUM" })
      ),
      mocked: false,
      reason: "INCOME_BELOW_MINIMUM",
      frontEndDtiBps:               gate.frontEndDtiBps,
      backEndDtiBps:                gate.backEndDtiBps,
      benchmarkAprBps:              gate.benchmarkAprBps,
      totalMonthlyObligationsCents: gate.totalMonthlyObligationsCents,
      effectiveIncomeCents:         gate.effectiveIncomeCents,
      ...INDETERMINATE_RISK,
    };
  }

  // ── STEP 2: MicroBilt OAuth + API call ─────────────────────────────────────
  let token: string;
  try {
    token = await getMicroBiltToken();
  } catch (err) {
    logger.error("[microbilt] OAuth failed:", err);
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
        "Accept":       "application/json",
        "X-CAID":       process.env.MICROBILT_CAID ?? "",
        "X-Product":    process.env.MICROBILT_PRODUCT ?? "IPredict Advantage",
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return timeoutResult();
    logger.error("[microbilt] iPredict network error:", err);
    return errorResult("NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Do NOT log the response body: on some errors MicroBilt echoes the request
    // (name/address/DOB) back, which would write consumer PII to app logs in
    // cleartext. The status code is enough to triage; the encrypted rawResponse
    // (below, on parseable bodies) holds detail for authorized inspection.
    logger.error(`[microbilt] iPredict HTTP ${res.status} (body suppressed — may contain PII)`);
    return errorResult(`HTTP_${res.status}`);
  }

  const raw = (await res.json().catch(() => ({}))) as IPredictResponse;

  // Detect ALL of iPredict's error shapes, not just RESPONSE.STATUS.type. A
  // response can signal failure via the message header severity, a RESPONSE
  // error object/code, or an action of "RESEND" (request must be resent). Any of
  // these means we did NOT get a usable decision — route to MANUAL_REVIEW with a
  // provider-error reason (which drives the admin alert) rather than silently
  // parsing an empty CONTENT into a plain review.
  const statusNode = raw.RESPONSE?.STATUS;
  const isIpredictError =
    statusNode?.type === "ERROR" ||
    !!statusNode?.error?.code ||
    !!statusNode?.error?.message ||
    statusNode?.action === "RESEND" ||
    raw.MsgRsHdr?.Status?.Severity === "Error";
  if (isIpredictError) {
    logger.error("[microbilt] iPredict returned ERROR:", statusNode ?? raw.MsgRsHdr?.Status);
    return { ...errorResult("IPREDICT_ERROR"), rawResponse: encryptRawResponse(JSON.stringify(raw)) };
  }

  // ── STEP 3: Parse MicroBilt response ──────────────────────────────────────
  const content      = raw.RESPONSE?.CONTENT;
  const decisionNode = content?.DECISION;
  const idv          = content?.SERVICEDETAILS?.IDV;
  const ofac         = content?.SERVICEDETAILS?.OFAC;

  const decisionCode  = decisionNode?.decision?.code;
  const decisionValue = decisionNode?.decision?.Value;

  // Loan amounts — spec fields: DECISION.recommendedLoanAmount / maxLoanAmount.
  const recommendedLoanAmountCents = decisionNode?.recommendedLoanAmount
    ? Math.round(parseFloat(decisionNode.recommendedLoanAmount) * 100)
    : null;

  const maxLoanAmountCents = decisionNode?.maxLoanAmount
    ? Math.round(parseFloat(decisionNode.maxLoanAmount) * 100)
    : null;

  // OFAC is a HARD, fail-closed gate. Distinguish three states, never collapsing
  // "no data" into "cleared": a hit (Y) → true; an explicit screening result
  // that is not a hit → false (screened & cleared); NEITHER signal present →
  // null (indeterminate). The orchestrator routes a null to manual review so an
  // approval can never be issued without an affirmative OFAC clear.
  const ofacFlagged = computeOfacFlag(idv?.OFACAlert, ofac?.ofacresult);
  const decision    = mapDecision(decisionCode, decisionValue);

  // ── Credit score from SCORES array — spec: DECISION.SCORES[].Value ─────────
  const scoresArray = decisionNode?.SCORES ?? [];
  const rawScore =
    scoresArray.length > 0 && scoresArray[0]?.Value ? scoresArray[0].Value : null;
  const parsedScore = rawScore !== null ? parseInt(String(rawScore), 10) : NaN;
  const creditScore =
    Number.isFinite(parsedScore) && parsedScore >= 300 && parsedScore <= 850
      ? parsedScore
      : null;

  // FCRA adverse action reason codes — spec: DECISION.REASONS[].code
  const adverseReasonCodes = (decisionNode?.REASONS ?? [])
    .map((r) => r.code)
    .filter((c): c is string => !!c);

  // ID Verify fraud warning + IDV score
  const fraudWarning = idv?.fraudWarning ?? null;
  const idvScoreParsed = idv?.score ? parseInt(idv.score, 10) : NaN;
  const idvScore = Number.isFinite(idvScoreParsed) ? idvScoreParsed : null;

  // MLA Verify covered-borrower status — check both spec locations. Honest
  // tri-state: an ABSENT status is null (indeterminate), NOT false — we must not
  // assert "not a covered borrower" when MLA was never screened (same failure
  // class as the OFAC gate). NOTE: the fail-closed *gate* on an indeterminate MLA
  // is intentionally deferred until a live iPredict Advantage pull confirms
  // whether MLA Verify is bundled in the response (else every approval would be
  // routed to review). Today Gate 3 keys on `=== true`, so null is a no-op.
  const mlaStatus =
    content?.SERVICEDETAILS?.MLA?.STATUS?.Value ?? content?.MLA?.STATUS?.Value ?? null;
  const mlaCovered =
    mlaStatus == null
      ? null
      : mlaStatus === "Y" ||
        mlaStatus.toUpperCase().includes("ACTIVE") ||
        mlaStatus.toUpperCase() === "COVERED";

  // Additional risk flags from IDV
  const deceasedFlag = idv?.deceasedIndicator === "Y";
  const bankruptcyFlag = idv?.bankruptcyFlag === "Y";
  const highRiskAddressFlag =
    idv?.highRiskAddress === "Y" || idv?.suspiciousAddress === "Y";

  // ── STEP 4: Two-gate minimum — income gate vs credit gate ─────────────────
  // Final OTD = min(income-computed max, MicroBilt-approved amount)
  // This is the same logic used by all major auto lenders.
  const creditGateAmount = recommendedLoanAmountCents ?? maxLoanAmountCents ?? null;

  let finalDecision     = decision;
  let maxOtdAmountCents = 0;
  let tier: PreQualTier | null = null;
  // PASS 2 income gate — defaults to the PASS 1 result until a tier is derived.
  let finalGate = gate;

  if (decision === PreQualDecision.APPROVED) {
    if (creditGateAmount !== null && creditGateAmount > 0) {
      // Preliminary OTD (PASS 1 income gate) — used only to derive the tier
      // when no credit score is available.
      const preliminaryMaxOtd = hasIncome
        ? Math.min(gate.incomeBasedMaxCents, creditGateAmount)
        : creditGateAmount;

      // ── STEP 5: Derive tier (prefer credit score; fall back to ratio) ──────
      tier = deriveTier(
        preliminaryMaxOtd,
        gate.requestedAmtCents,
        args.monthlyIncomeCents ?? null,
        creditScore,
      );

      // PASS 2: re-run the income gate with the tier-specific benchmark APR
      // (tier hint derived from the parsed creditScore) for a more accurate
      // monthly payment / buying-power estimate.
      if (hasIncome) {
        finalGate = computeIncomeGate({
          ...incomeGateBase,
          benchmarkTier: tierToBenchmark(tier),
        });
        // Both gates have data: take the conservative minimum
        maxOtdAmountCents = Math.min(finalGate.incomeBasedMaxCents, creditGateAmount);
      } else {
        // No income validation: use credit gate only (less accurate)
        maxOtdAmountCents = creditGateAmount;
      }

      // A near/at-DTI-limit final amount that falls below the platform floor
      // means there is no viable loan even though credit approved.
      if (maxOtdAmountCents <= 0) {
        finalDecision = PreQualDecision.MANUAL_REVIEW;
        tier = null;
      }
    } else {
      // MicroBilt approved but returned no amount — cannot issue reliable budget
      finalDecision     = PreQualDecision.MANUAL_REVIEW;
      maxOtdAmountCents = 0;
      logger.warn("[microbilt] APPROVED with no loan amount — routing to MANUAL_REVIEW");
    }
  }

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
    // Decision detail comes from the FINAL (tier-aware) income gate.
    frontEndDtiBps:               hasIncome ? finalGate.frontEndDtiBps : null,
    backEndDtiBps:                hasIncome ? finalGate.backEndDtiBps : null,
    benchmarkAprBps:              hasIncome ? finalGate.benchmarkAprBps : null,
    totalMonthlyObligationsCents: hasIncome ? finalGate.totalMonthlyObligationsCents : null,
    effectiveIncomeCents:         hasIncome ? finalGate.effectiveIncomeCents : null,
    // ── iPredict_6.yaml spec fields ──────────────────────────────────────────
    creditScore,
    idvScore,
    mlaCovered,
    fraudWarning,
    adverseReasonCodes,
    deceasedFlag,
    bankruptcyFlag,
    highRiskAddressFlag,
  };
}

// Map a PreQualTier to the BenchmarkTier used for APR selection.
function tierToBenchmark(tier: PreQualTier | null): BenchmarkTier {
  switch (tier) {
    case PreQualTier.STRONG: return "STRONG";
    case PreQualTier.GOOD:   return "GOOD";
    case PreQualTier.FAIR:   return "FAIR";
    case PreQualTier.WEAK:   return "WEAK";
    default:                 return "UNKNOWN";
  }
}

// Tier derivation — prefers the iPredict credit score (300–850 per spec) when
// available, otherwise falls back to the approval-ratio + payment-to-income
// logic. Mirrors Capital One / Chase / credit union tier bands.
function deriveTier(
  approvedCents:      number,
  requestedCents:     number,
  monthlyIncomeCents: number | null,
  creditScore:        number | null,
): PreQualTier {
  // PREFER credit score when present.
  if (creditScore !== null && creditScore > 0) {
    if (creditScore >= 720) return PreQualTier.STRONG;
    if (creditScore >= 660) return PreQualTier.GOOD;
    if (creditScore >= 600) return PreQualTier.FAIR;
    return PreQualTier.WEAK;
  }

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

// ─── Response shape — iPredict_6.yaml spec (subset we read) ──────────────────
interface IPredictResponse {
  MBCLVRq?: unknown; // echoed request
  MsgRsHdr?: {
    RqUID?: string;
    Status?: {
      StatusCode?: number;
      Severity?: "Error" | "Warn" | "Info";
      StatusDesc?: string;
    };
  };
  RESPONSE?: {
    REQUESTINGSYSTEM?: unknown;
    HEADER?: unknown;
    STATUS?: {
      applicationNumber?: string;
      type?: "SUCCESS" | "ERROR";
      action?: "RESEND" | "DONE";
      error?: {
        message?: string;
        code?: string;
        type?: "APPLICATION" | "SYSTEM";
      };
    };
    CONTENT?: {
      DECISION?: {
        decision?: {
          code?: string;
          Value?: string;
        };
        decisionTimestamp?: string;
        recommendedLoanAmount?: string;
        maxLoanAmount?: string;
        SCORES?: Array<{
          type?: string;
          model?: string;
          performsLikeScore?: string;
          profitabilityLift?: string;
          Value?: string; // actual score
        }>;
        REASONS?: Array<{
          code?: string;
          Value?: string;
        }>;
        PROPERTIES?: Array<{
          name?: string;
          Value?: string;
        }>;
      };
      SERVICEDETAILS?: {
        IDV?: {
          score?: string;
          OFACAlert?: string;
          fraudWarning?: string;
          deceasedIndicator?: string;
          bankruptcyFlag?: string;
          highRiskEmail?: string;
          highRiskAddress?: string;
          suspiciousSSN?: string;
          suspiciousDOB?: string;
          suspiciousAddress?: string;
          suspiciousPhone?: string;
          ssnNameMatch?: string;
          ssnAddressMatch?: string;
          ALERTS?: Array<{
            code?: string;
            description?: string;
            Value?: string;
          }>;
        };
        OFAC?: {
          ofacresult?: string;
          ofacname?: string;
          ofaclist?: string;
          ofacremarks?: string;
        };
        MLA?: {
          STATUS?: {
            code?: string;
            Value?: string;
          };
        };
        BAV?: {
          SUMMARY?: {
            highRiskIndicator?: string;
            SCORE?: { value?: string };
          };
        };
      };
      MLA?: {
        STATUS?: {
          code?: string;
          Value?: string;
        };
      };
    };
  };
}

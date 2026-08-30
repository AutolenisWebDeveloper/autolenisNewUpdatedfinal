// lib/services/prequal/microbilt.service.ts
// Real MicroBilt iPredict integration — soft pull only. No hard credit pull.
// rawResponse stored AES-256-GCM encrypted at rest.
// Sandbox bypass: MICROBILT_SANDBOX=true returns hardcoded mock as the FIRST
// check (no OAuth, no network). Hard 10s AbortController timeout on the real
// call returns MANUAL_REVIEW with reason TIMEOUT. ERROR-status responses are
// logged and downgraded to MANUAL_REVIEW — never thrown to the buyer.

import { logger } from "@/lib/logger";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  computeIncomeGate,
  getBenchmarkApr,
  type BenchmarkTier,
  type IncomeGateResult,
} from "./income-gate";

// ─── Provider-failure taxonomy ──────────────────────────────────────────────
// The adapter owns the vocabulary for "we did not get a usable answer from the
// provider". It is exported (rather than restated by callers) so a newly added
// failure mode is classified as a provider failure everywhere at once — the
// orchestrator previously kept its own copy of this list, and any reason added
// here but forgotten there would silently degrade back into an unlabelled
// MANUAL_REVIEW indistinguishable from a compliance hold.
//
// NOTE: a business outcome (e.g. INCOME_BELOW_MINIMUM) is deliberately NOT in
// this set — that is a real decision, not an integration failure.
export const PROVIDER_ERROR_REASONS: ReadonlySet<string> = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "OAUTH_FAILED",
  "IPREDICT_ERROR",
  "CONFIG_ERROR",
  "CONFIG_MISMATCH",
  "URL_NOT_CONFIGURED",
  // The report URL is present but does not address the spec's POST /GetReport
  // endpoint. getReportUrl() returns the env value verbatim (no concatenation),
  // so this would otherwise POST the consumer-report request to the wrong path.
  "REPORT_URL_INVALID",
  // The provider answered 200 but gave us nothing usable. Both were previously
  // swallowed into a plain MANUAL_REVIEW carrying no reason at all.
  "EMPTY_RESPONSE",
  "UNPARSEABLE_RESPONSE",
  // MsgRqHdr identity/routing env vars missing — an ops config failure caught
  // before the call, so it must page rather than sit as an ordinary review.
  "IDENTITY_NOT_CONFIGURED",
]);

// A recorded reason has the grammar  BASE[:TYPE][:CODE]  where BASE is one of
// PROVIDER_ERROR_REASONS (or HTTP_<status>), TYPE is MicroBilt's
// RESPONSE.STATUS.error.type, and CODE is its error code. The detail suffixes
// are diagnostics only — classification always keys on BASE, so adding detail
// can never reclassify a failure or slip one past the orchestrator's alerting.

/** The stable classification token of a reason, stripped of any detail suffix. */
export function providerReasonBase(reason: string): string {
  const i = reason.indexOf(":");
  return i === -1 ? reason : reason.slice(0, i);
}

/** True when `reason` denotes an upstream provider failure rather than a decision. */
export function isProviderErrorReason(reason: string | undefined | null): boolean {
  if (!reason) return false;
  const base = providerReasonBase(reason);
  return PROVIDER_ERROR_REASONS.has(base) || base.startsWith("HTTP_");
}

/**
 * How ops should treat a provider failure.
 *
 *  REQUEST_REJECTED     — the request we sent is wrong (malformed payload, bad
 *                         credentials, misconfigured URL). Retrying it
 *                         unchanged cannot help; an engineer must fix it.
 *  PROVIDER_UNAVAILABLE — MicroBilt was reachable-but-unwell or unreachable.
 *                         The same request may succeed later.
 *  UNKNOWN              — we genuinely cannot tell. Never guessed either way:
 *                         claiming "transient" for a permanent break is how an
 *                         outage stays invisible.
 */
export type ProviderFailureClass = "REQUEST_REJECTED" | "PROVIDER_UNAVAILABLE" | "UNKNOWN";

// Config faults are ours, not the provider's — a retry cannot fix them.
// Keep this in step with PROVIDER_ERROR_REASONS: a reason added there but not
// classified here silently degrades to UNKNOWN, which tells an operator the
// failure "could not be classified" for what is in fact a plain missing env
// var. microbilt-provider-outcome.test.ts enforces that every reason is either
// classified or explicitly listed as ambiguous.
const REQUEST_REJECTED_BASES: ReadonlySet<string> = new Set([
  "CONFIG_ERROR",
  "CONFIG_MISMATCH",
  "URL_NOT_CONFIGURED",
  "REPORT_URL_INVALID",
  "IDENTITY_NOT_CONFIGURED",
]);
const PROVIDER_UNAVAILABLE_BASES: ReadonlySet<string> = new Set(["TIMEOUT", "NETWORK_ERROR"]);

export function classifyProviderFailure(
  reason: string | undefined | null,
): ProviderFailureClass {
  if (!reason || !isProviderErrorReason(reason)) return "UNKNOWN";

  // MicroBilt's own verdict wins when it gave one. `type` occupies the slot
  // right after BASE; a bare error code can only land there when no type was
  // returned, and a code literally named APPLICATION/SYSTEM carries the same
  // meaning as the type would, so the classification is right either way.
  const declaredType = reason.split(":")[1];
  if (declaredType === "APPLICATION") return "REQUEST_REJECTED";
  if (declaredType === "SYSTEM") return "PROVIDER_UNAVAILABLE";

  const base = providerReasonBase(reason);
  if (REQUEST_REJECTED_BASES.has(base)) return "REQUEST_REJECTED";
  if (PROVIDER_UNAVAILABLE_BASES.has(base)) return "PROVIDER_UNAVAILABLE";

  if (base.startsWith("HTTP_")) {
    const status = Number(base.slice("HTTP_".length));
    if (!Number.isFinite(status)) return "UNKNOWN";
    // 429 is a 4xx but is explicitly "come back later".
    if (status === 429 || status >= 500) return "PROVIDER_UNAVAILABLE";
    if (status >= 400) return "REQUEST_REJECTED";
  }

  // OAUTH_FAILED covers both bad credentials and a transient token-endpoint
  // failure; EMPTY/UNPARSEABLE/untyped IPREDICT_ERROR are ambiguous by nature.
  return "UNKNOWN";
}

// ─── Provider error detail (diagnostics that are safe in cleartext) ──────────
// MicroBilt echoes request data on some errors, and a recorded reason travels
// to ComplianceEvent metadata and the admin alert EMAIL in cleartext. Only a
// short opaque token may be promoted there; anything free-form (a message with
// spaces, a long string) stays exclusively in the encrypted rawResponse.
const PROVIDER_TOKEN_MAX_CHARS = 32;

function sanitizeProviderToken(value: string | undefined | null): string | null {
  if (!value) return null;
  const token = value.trim().toUpperCase();
  if (!token || token.length > PROVIDER_TOKEN_MAX_CHARS) return null;
  return /^[A-Z0-9_.-]+$/.test(token) ? token : null;
}

interface ProviderErrorDetail {
  type: string | null;
  code: string | null;
}

/** Pull the (sanitized) error type + code out of a RESPONSE.STATUS node. */
function extractProviderErrorDetail(status: IPredictErrorStatus | undefined): ProviderErrorDetail {
  const declared = status?.error?.type;
  return {
    // Only the two values the spec defines are trusted as a type.
    type: declared === "APPLICATION" || declared === "SYSTEM" ? declared : null,
    code: sanitizeProviderToken(status?.error?.code),
  };
}

/** Compose `BASE[:TYPE][:CODE]`. */
function buildProviderReason(base: string, detail: ProviderErrorDetail): string {
  return [base, detail.type, detail.code].filter(Boolean).join(":");
}

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
// Account identity + product routing are NOT URL/header concerns — they live in
// the request body's MsgRqHdr and come from MICROBILT_MEMBER_ID /
// MICROBILT_MEMBER_PASSWORD / MICROBILT_USERNAME / MICROBILT_PRODUCT_ID.

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

// ─── MsgRqHdr identity & product routing (iPredict_6.yaml spec) ──────────────
// The spec's security scheme is `oauth: []` ONLY. The Bearer token authenticates
// the CALLER, but carries no indication of which member account or which product
// the request is for — that routing lives in the request BODY's MsgRqHdr. A
// request without it cannot be routed and is rejected by MicroBilt.
//
// All four values are account-specific and issued by MicroBilt. There is no safe
// default for any of them, so none is ever defaulted or invented.
//
// Each field is resolved INDEPENDENTLY and sent when it is set. The gate used to
// require all four together, which meant a deployment configured with only
// MICROBILT_PRODUCT_ID sent NO identity at all — MicroBilt was never told which
// product was being requested, and every prequal came back as an unexplained
// MANUAL_REVIEW. A field that is unset is OMITTED from MsgRqHdr; it is never
// blanked, because an empty string looks configured while still being
// unroutable. When nothing at all is configured the adapter still refuses to
// spend an inquiry (IDENTITY_NOT_CONFIGURED) — see callIPredict.
//
// MemberPwd is a CREDENTIAL: read only inside this adapter, never logged, and
// never surfaced by getMicroBiltConfigStatus().
const IDENTITY_ENV = {
  MemberId:  "MICROBILT_MEMBER_ID",
  MemberPwd: "MICROBILT_MEMBER_PASSWORD",
  UserName:  "MICROBILT_USERNAME",
  ProductID: "MICROBILT_PRODUCT_ID",
} as const;

/**
 * The MsgRqHdr identity fragment actually configured for this deployment.
 *
 * Partial by design: MicroBilt has issued some AutoLenis accounts only a
 * ProductID. Every key present here was read from env and is non-blank; a key
 * that is absent was not configured and must not appear in the request.
 */
type MicroBiltIdentity = Partial<{
  MemberId:  string;
  MemberPwd: string;
  UserName:  string;
  ProductID: string;
}>;

/**
 * Resolve whichever of the four MsgRqHdr identity fields are configured.
 *
 * A value that is absent OR only whitespace counts as MISSING: a blank identity
 * field is worse than an absent one, because it looks configured while still
 * being unroutable — the same class of bug as sending an empty header. Missing
 * fields are simply left out of the returned object, so they cannot reach the
 * wire as `""`, `null`, or a guessed value.
 *
 * Keys are inserted in the spec's field order (MemberId, MemberPwd, UserName,
 * ProductID), so MsgRqHdr keeps its documented shape for whatever subset is set.
 *
 * `missing` carries the env var NAMES that are unset (never their values) so
 * callers can tell ops exactly what to set without leaking a credential into a
 * log line. It is reported even when the call proceeds — a partial identity is
 * still a deployment ops needs to finish.
 */
function resolveIdentity(): { identity: MicroBiltIdentity; missing: string[] } {
  const read = (envName: string): string | null => process.env[envName]?.trim() || null;

  const identity: MicroBiltIdentity = {};
  const missing: string[] = [];

  const take = (field: keyof MicroBiltIdentity, envName: string): void => {
    const value = read(envName);
    if (value) identity[field] = value;
    else missing.push(envName);
  };

  take("MemberId",  IDENTITY_ENV.MemberId);
  take("MemberPwd", IDENTITY_ENV.MemberPwd);
  take("UserName",  IDENTITY_ENV.UserName);
  take("ProductID", IDENTITY_ENV.ProductID);

  return { identity, missing };
}

/**
 * Non-secret MicroBilt configuration snapshot for the admin system-health page.
 * Never returns client secret, token, or MemberPwd — only URLs, product, CAID,
 * and booleans indicating whether each credential is present.
 */
export function getMicroBiltConfigStatus() {
  const clientId = process.env.MICROBILT_CLIENT_ID;
  const { missing: missingIdentity } = resolveIdentity();
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
    // MsgRqHdr identity/routing readiness. Presence booleans only — MemberPwd is
    // a credential and must never appear here. ProductID is a product SELECTOR,
    // not a secret, and ops needs its value to confirm the right product is
    // configured, so it is the one identity value returned verbatim.
    identity: {
      memberIdPresent:  !!process.env[IDENTITY_ENV.MemberId]?.trim(),
      memberPwdPresent: !!process.env[IDENTITY_ENV.MemberPwd]?.trim(),
      userNamePresent:  !!process.env[IDENTITY_ENV.UserName]?.trim(),
      productId:        process.env[IDENTITY_ENV.ProductID]?.trim() || null,
      missing:          missingIdentity,
    },
  };
}

// ─── Credential redaction before the report is persisted ────────────────────
// iPredict echoes the submitted request back in the response (`MBCLVRq`), so our
// own MsgRqHdr.MemberPwd can return inside the body we store. The stored
// rawResponse is decryptable by an authorized operator (scripts/decrypt-prequal-
// error.ts prints the whole document), and it lives on a consumer-report record
// subject to retention and disclosure rules — a place a MicroBilt account
// password has no business being, even encrypted.
//
// Redaction is keyed on the FIELD NAME rather than a fixed path, because we do
// not control how the provider nests the echo.
const REDACTED_RESPONSE_KEYS = new Set(["memberpwd", "memberpassword", "password"]);
const MAX_REDACT_DEPTH = 20;

function redactCredentials(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > MAX_REDACT_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => redactCredentials(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED_RESPONSE_KEYS.has(k.toLowerCase())
      ? "[REDACTED]"
      : redactCredentials(v, depth + 1);
  }
  return out;
}

/** Serialize a provider response for storage, with credentials stripped. */
function serializeRawResponse(raw: unknown): string {
  return JSON.stringify(redactCredentials(raw));
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

// Provider failure that also has a response body worth keeping for diagnosis.
// The reason is kept INSIDE the stored payload so an operator decrypting the
// blob still learns which failure it was — the body alone does not say.
function errorResultWithBody(reason: string, body: unknown): IPredicResult {
  return {
    ...errorResult(reason),
    // redactCredentials: iPredict echoes our request (MBCLVRq), which now carries
    // MsgRqHdr.MemberPwd. Strip it before this is encrypted and persisted.
    rawResponse: encryptRawResponse(
      JSON.stringify({ referred: true, reason, response: redactCredentials(body) }),
    ),
  };
}

// A hostile or broken upstream can return an unbounded body (an HTML error page
// behind a gateway). rawResponse is a single TEXT column read by an operator, so
// the stored copy is capped — truncated explicitly rather than silently.
const MAX_STORED_ERROR_BODY_CHARS = 16_000;

// The fetch AbortController's timer is cleared as soon as the response HEADERS
// arrive, so it does NOT cover reading the body. A response whose body never
// completes would hold the buyer's prequal request open forever, so the read
// carries its own bound. Losing the body costs us only diagnostics — the
// failure is still classified and still fail-closed.
const ERROR_BODY_READ_TIMEOUT_MS = 5_000;

/**
 * Read a non-2xx response body for storage. JSON is kept as JSON so the
 * offending-field detail stays queryable after decryption; anything else is
 * kept as text. Never throws and never hangs — a failure to read the body must
 * not turn a classified provider failure into an unhandled exception or a
 * stalled request.
 */
async function readErrorBody(res: Response, controller: AbortController): Promise<unknown> {
  const TIMED_OUT = Symbol("timed-out");

  // The catch is attached here so that aborting below rejects into it rather
  // than surfacing as an unhandled rejection.
  const readPromise: Promise<string | null> = res.text().catch((err: unknown) => {
    logger.error("[microbilt] could not read the iPredict error body:", err);
    return null;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ERROR_BODY_READ_TIMEOUT_MS);
  });

  let result: string | null | typeof TIMED_OUT;
  try {
    result = await Promise.race([readPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }

  if (result === TIMED_OUT) {
    logger.error(
      "[microbilt] timed out reading the iPredict error body — releasing the connection",
    );
    // Abort the ORIGINAL fetch controller rather than cancelling res.body:
    // res.text() has already locked the stream, so cancel() would throw and the
    // socket would stay open. Aborting tears the connection down and rejects the
    // pending read into the catch attached above.
    controller.abort();
    return null;
  }

  const text = result;
  if (!text) return null;
  if (text.length > MAX_STORED_ERROR_BODY_CHARS) {
    return {
      truncated: true,
      originalLength: text.length,
      text: text.slice(0, MAX_STORED_ERROR_BODY_CHARS),
    };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The RESPONSE.STATUS node of a stored error body, when it has one. */
function errorStatusOf(body: unknown): IPredictErrorStatus | undefined {
  if (!body || typeof body !== "object") return undefined;
  return (body as { RESPONSE?: { STATUS?: IPredictErrorStatus } }).RESPONSE?.STATUS;
}

/** Absent, or present-but-blank — both mean "the provider told us nothing here". */
function isBlank(v: string | undefined | null): boolean {
  return v == null || v.trim() === "";
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
 *
 * The MsgRqHdr identity fields are resolved by resolveIdentity() before this is
 * called — the spec's security scheme is `oauth: []` only, so the Bearer token
 * identifies the caller but selects neither the member account nor the product.
 * Whichever fields are configured are spread in at the head of MsgRqHdr in spec
 * order; the rest are omitted entirely rather than sent blank. callIPredict
 * fails closed (IDENTITY_NOT_CONFIGURED) when NONE is configured, rather than
 * spending an inquiry on a request MicroBilt cannot route at all.
 *
 * STILL DEFERRED, awaiting a confirmed request example from MicroBilt support:
 * the MBCLVRq envelope, ContactInfo object-vs-array, and whether the X-CAID /
 * X-Product headers are read at all. Changing several unknowns at once would
 * make the next failure uninterpretable, so none of those is changed here.
 */
function buildPayload(
  buyer: MicroBiltBuyerPII,
  gate: IncomeGateResult,
  identity: MicroBiltIdentity,
) {
  return {
    MsgRqHdr: {
      // Identity + product routing (spec field order, preserved by
      // resolveIdentity's insertion order). Without these MicroBilt cannot
      // resolve the member account or select the product, and rejects the
      // request regardless of a valid Bearer token. Only CONFIGURED fields are
      // spread in: an unset field is absent from the request rather than blank,
      // so MicroBilt sees exactly what this deployment actually has.
      ...identity,
      RequestType: "N",
      ReasonCode:  "3",
      RefNum:      randomUUID(),
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
  const { identity, missing: missingIdentity } = resolveIdentity();

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
    // Missing is checked BEFORE malformed, so an unset var reports the right
    // root cause instead of "invalid suffix" on an empty string.
    if (!reportUrl || !oauthUrl) {
      logger.error(
        "[microbilt] CRITICAL: missing production URLs. reportUrl=" +
        !!reportUrl + " oauthUrl=" + !!oauthUrl
      );
      return errorResult("URL_NOT_CONFIGURED");
    }
    // getReportUrl() returns the env value VERBATIM — nothing appends the spec
    // path — so a URL that does not address POST /GetReport silently sends the
    // consumer-report request somewhere else. That was a warning; it is a hard
    // config error, because a warning in a Vercel log is not a control.
    if (!reportUrl.endsWith("/GetReport")) {
      logger.error(
        "[microbilt] CRITICAL: report URL does not address the spec endpoint " +
        "POST /GetReport. Refusing to send the request. Routing to MANUAL_REVIEW."
      );
      return errorResult("REPORT_URL_INVALID");
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

  // ── MsgRqHdr identity guard (fail closed BEFORE spending an inquiry) ───────
  // A GetReport call carrying NO identity at all cannot be routed to a member
  // account or a product under any circumstance, so MicroBilt rejects it —
  // which historically surfaced only as an opaque HTTP_<status>. Stop here
  // instead and name exactly which env vars ops must set. Only the variable
  // NAMES are logged; the values (one of which is a credential) never are.
  //
  // A PARTIAL identity is NOT stopped. Requiring all four was the defect: a
  // deployment holding only MICROBILT_PRODUCT_ID sent no routing whatsoever and
  // every prequal returned an unexplained MANUAL_REVIEW. Sending what we
  // actually have lets MicroBilt answer, or reject with a reason we can read.
  if (Object.keys(identity).length === 0) {
    logger.error(
      "[microbilt] CRITICAL: MsgRqHdr identity/routing is entirely unconfigured — missing " +
        missingIdentity.join(", ") +
        ". Routing to MANUAL_REVIEW without calling GetReport.",
    );
    return errorResult("IDENTITY_NOT_CONFIGURED");
  }
  if (missingIdentity.length > 0) {
    // Proceed, but keep the deployment gap visible: an incomplete identity is a
    // likely cause of a downstream rejection, and ops needs the var names to
    // close it. Names only — MemberPwd's value never reaches a log line.
    logger.warn(
      "[microbilt] MsgRqHdr identity/routing is PARTIAL — unset: " +
        missingIdentity.join(", ") +
        ". Sending only the configured fields; MicroBilt may still reject the request.",
    );
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

  const payload = buildPayload(args.buyer, gate, identity);

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
    // Keep the body. For a 400 it names the offending field, and discarding it
    // is why eight weeks of production failures were unreadable. It goes into
    // the SAME AES-256-GCM encrypted rawResponse the 200-error path already
    // uses — never into an app log, because on some errors MicroBilt echoes the
    // request (name/address/DOB) back and that would write consumer PII in
    // cleartext. Only the status and a short opaque provider token are logged.
    const body = await readErrorBody(res, controller);
    const reason = buildProviderReason(
      `HTTP_${res.status}`,
      extractProviderErrorDetail(errorStatusOf(body)),
    );
    logger.error(
      `[microbilt] iPredict ${reason} — response body stored encrypted in rawResponse ` +
        `(suppressed here: may contain PII)`,
    );
    return errorResultWithBody(reason, body);
  }

  // A body that is not valid JSON is a provider failure, not an empty report.
  // This previously degraded to `{}` and flowed on as an unlabelled
  // MANUAL_REVIEW, hiding gateway/HTML error pages behind a 200. Do NOT log the
  // body — it may echo consumer PII.
  let raw: IPredictResponse;
  try {
    raw = (await res.json()) as IPredictResponse;
  } catch {
    logger.error(
      "[microbilt] iPredict 200 with an unparseable body (body suppressed — may contain PII)",
    );
    return errorResult("UNPARSEABLE_RESPONSE");
  }

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
    // APPLICATION = our request is malformed (a retry cannot help, an engineer
    // must fix it). SYSTEM = the provider blipped (retryable). The type was
    // declared on the response interface but never read, so both looked
    // identical to ops and to the admin queue.
    const reason = buildProviderReason("IPREDICT_ERROR", extractProviderErrorDetail(statusNode));
    logger.error(
      `[microbilt] iPredict returned ERROR (${reason}) — body stored encrypted in rawResponse`,
    );
    return errorResultWithBody(reason, raw);
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

  // ── No decision content at all ⇒ a provider failure, not a review ─────────
  // A 200 whose body carries no DECISION (neither code nor value, blanks
  // included) means the provider returned nothing we can act on. Previously
  // `mapDecision(undefined, undefined)` folded this into a plain MANUAL_REVIEW
  // carrying NO reason, making an integration outage look identical to a
  // compliance hold. The decision is unchanged (still MANUAL_REVIEW, still
  // fail-closed) — only the labelling is now honest.
  //
  // This deliberately runs AFTER the risk parsing above and carries those
  // signals through: a response can lack a DECISION while still reporting a
  // sanctions hit or a deceased indicator, and resetting those to
  // INDETERMINATE would lose a positive OFAC hit (and its ops alert) on the way
  // out. Only the decision is missing — whatever risk data did arrive still
  // reaches the gates.
  if (isBlank(decisionCode) && isBlank(decisionValue)) {
    logger.error(
      "[microbilt] iPredict 200 carried no DECISION content — recording as a provider failure",
    );
    return {
      ...errorResultWithBody("EMPTY_RESPONSE", raw),
      ofacFlagged,
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
    rawResponse: encryptRawResponse(serializeRawResponse(raw)),
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

/**
 * RESPONSE.STATUS. `error.type` is the request-vs-provider verdict: APPLICATION
 * means MicroBilt rejected what we sent (malformed / missing field), SYSTEM
 * means their side failed. It is read by extractProviderErrorDetail.
 */
interface IPredictErrorStatus {
  applicationNumber?: string;
  type?: "SUCCESS" | "ERROR";
  action?: "RESEND" | "DONE";
  error?: {
    message?: string;
    code?: string;
    type?: "APPLICATION" | "SYSTEM";
  };
}

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
    STATUS?: IPredictErrorStatus;
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

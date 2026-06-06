// lib/services/prequal/errors.ts
// Structured error taxonomy for prequal provider failures (P0-2).
//
// The MicroBilt integration (microbilt.service.ts) already downgrades provider
// failures to MANUAL_REVIEW and returns a `reason` code instead of throwing —
// buyer-facing behavior we deliberately preserve. This module turns that
// transient `reason` into queryable, UNENCRYPTED error metadata (errorStage /
// errorCode) for admin triage. The raw provider payload stays AES-256-GCM
// encrypted in rawResponse; only the stage/code/message are surfaced in the clear.

export type PrequalErrorStage =
  | "CONFIG"
  | "OAUTH"
  | "HTTP_CALL"
  | "RESPONSE_PARSE"
  | "DECISION_MAP"
  | "PERSISTENCE";

export type PrequalErrorCode =
  | "MISSING_BASE_URL"
  | "MISSING_CREDENTIALS"
  | "CONFIG_MISMATCH"
  | "OAUTH_TOKEN_FAILED"
  | "REQUEST_TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "PROVIDER_ERROR_STATUS"
  | "DB_WRITE_FAILED"
  | "UNKNOWN";

export interface PrequalErrorMeta {
  stage: PrequalErrorStage;
  code: PrequalErrorCode;
  message: string;
  httpStatus?: number;
  requestedUrl?: string;
}

// Reasons returned by callIPredict that represent a genuine PROVIDER FAILURE
// (downgraded to MANUAL_REVIEW). INCOME_BELOW_MINIMUM is a business decision
// (DECLINED), not a provider error, and is intentionally excluded.
const PROVIDER_ERROR_REASONS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "OAUTH_FAILED",
  "IPREDICT_ERROR",
  "CONFIG_ERROR",
  "CONFIG_MISMATCH",
  "URL_NOT_CONFIGURED",
]);

export function isProviderErrorReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return PROVIDER_ERROR_REASONS.has(reason) || reason.startsWith("HTTP_");
}

/**
 * Map a callIPredict `reason` code to structured error metadata, or null when
 * the reason is not a provider failure (success, true MANUAL_REVIEW, or a
 * business DECLINED such as INCOME_BELOW_MINIMUM). `errorMeta != null` is the
 * single discriminator the persistence layer uses to decide whether to write
 * error columns + a PrequalAttemptError row.
 */
export function reasonToErrorMeta(
  reason: string | null | undefined,
): PrequalErrorMeta | null {
  if (!isProviderErrorReason(reason)) return null;
  const r = reason as string;

  if (r.startsWith("HTTP_")) {
    const status = parseInt(r.slice("HTTP_".length), 10);
    const httpStatus = Number.isFinite(status) ? status : undefined;
    const code: PrequalErrorCode =
      httpStatus && httpStatus >= 500
        ? "HTTP_5XX"
        : httpStatus && httpStatus >= 400
          ? "HTTP_4XX"
          : "PROVIDER_ERROR_STATUS";
    return {
      stage: "HTTP_CALL",
      code,
      message: `MicroBilt iPredict returned ${r}`,
      httpStatus,
    };
  }

  switch (r) {
    case "TIMEOUT":
      return { stage: "HTTP_CALL", code: "REQUEST_TIMEOUT", message: "MicroBilt iPredict call timed out (10s AbortController)." };
    case "NETWORK_ERROR":
      return { stage: "HTTP_CALL", code: "NETWORK_ERROR", message: "Network error reaching MicroBilt iPredict." };
    case "OAUTH_FAILED":
      return { stage: "OAUTH", code: "OAUTH_TOKEN_FAILED", message: "MicroBilt OAuth2 token request failed." };
    case "IPREDICT_ERROR":
      return { stage: "RESPONSE_PARSE", code: "PROVIDER_ERROR_STATUS", message: "MicroBilt iPredict returned an ERROR status." };
    case "CONFIG_ERROR":
      return { stage: "CONFIG", code: "MISSING_CREDENTIALS", message: "MicroBilt credentials or report URL missing/placeholder (sandbox not enabled)." };
    case "CONFIG_MISMATCH":
      return { stage: "CONFIG", code: "CONFIG_MISMATCH", message: "Production mode but MicroBilt URL points to apitest." };
    case "URL_NOT_CONFIGURED":
      return { stage: "CONFIG", code: "MISSING_BASE_URL", message: "MicroBilt production report/OAuth URLs not configured." };
    default:
      return { stage: "HTTP_CALL", code: "UNKNOWN", message: `Unrecognized provider failure: ${r}` };
  }
}

// lib/api/client.ts — the single sanctioned way for client components to call
// the role-scoped APIs (Phase 2, T1).
//
// The buyer/dealer/affiliate/admin APIs wrap success as { success, data } and
// errors as { error: { code, message }, correlationId } (see lib/auth/*-api).
// Reading the payload at the wrong depth (data.x instead of data.data.x) or
// treating error as a string caused the two dealer Criticals (C-1/C-2) and the
// OfferResponseButtons redirect bug. This client unwraps the envelope INTERNALLY
// and returns the payload typed as T, so call sites read `result.x` directly —
// there is no `.data` to get wrong, and the mistake becomes structurally
// impossible. Errors always surface `.message` via a typed ApiError.

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId?: string;
  /** Machine-readable context some errors carry so the caller can act on them
   *  rather than just print them — e.g. CHARGE_UNSETTLED ships the
   *  PaymentIntent id the buyer must be shown instead of a second card form.
   *  Mirrors the optional `details` bag in errorResponse (lib/auth/api). */
  readonly details?: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    status: number,
    correlationId?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
    this.details = details;
  }
}

type SuccessEnvelope<T> = { success: true; data: T };
type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
  correlationId?: string;
};

async function parse<T>(res: Response): Promise<T> {
  // Some routes return an empty body on error paths; tolerate that.
  const body = (await res.json().catch(() => null)) as (SuccessEnvelope<T> & ErrorEnvelope) | null;

  if (!res.ok || !body || body.success !== true) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const message = body?.error?.message ?? "Something went wrong. Please try again.";
    throw new ApiError(code, message, res.status, body?.correlationId, body?.error?.details);
  }
  return body.data;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** JSON-serializable body — Content-Type is set automatically. */
  json?: unknown;
}

async function request<T>(method: string, url: string, opts: ApiRequestOptions = {}): Promise<T> {
  const { json, headers, ...rest } = opts;
  const init: RequestInit = { method, ...rest };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers = { "Content-Type": "application/json", ...(headers ?? {}) };
  } else if (headers) {
    init.headers = headers;
  }
  const res = await fetch(url, init);
  return parse<T>(res);
}

/** Typed API client. Each method unwraps the envelope and returns the payload
 *  as T; on any non-success it throws ApiError (read err.message / err.code). */
export const api = {
  get:   <T>(url: string, opts?: ApiRequestOptions) => request<T>("GET", url, opts),
  post:  <T>(url: string, json?: unknown, opts?: ApiRequestOptions) => request<T>("POST", url, { ...opts, json }),
  put:   <T>(url: string, json?: unknown, opts?: ApiRequestOptions) => request<T>("PUT", url, { ...opts, json }),
  patch: <T>(url: string, json?: unknown, opts?: ApiRequestOptions) => request<T>("PATCH", url, { ...opts, json }),
  del:   <T>(url: string, opts?: ApiRequestOptions) => request<T>("DELETE", url, opts),
};

/** Narrow an unknown catch value to a user-facing message. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
}

// ── The public intake contract ──────────────────────────────────────────────
//
// `POST /api/public/request-vehicle` answers three materially different things
// with the same HTTP 200, and four hand-rolled fetches each decided for
// themselves what it meant. Only one of them parsed the body: the other three
// treated `res.ok` as "the request is in", so a capture that attached to NOTHING
// fired an ad conversion and redirected to a page reading "Request Received!".
//
// The classification lives here, once. `IntakeOutcome` is a discriminated union
// with no `success` field, so there is nothing to misread at the wrong depth —
// a caller has to switch on `kind`, and the compiler says so. The rule the union
// encodes is the one §7.2 cares about: a VehicleRequest either exists or it does
// not, and `requiresClaim` alone has never answered that question (it is also set
// for an ordinary guest capture, which DID create a request).

/** What actually happened to a public vehicle-request submission. */
export type IntakeOutcome =
  /** A VehicleRequest exists. The only outcome that is a conversion. */
  | {
      kind: "persisted";
      vehicleRequestId: string;
      buyerOpportunityId: string;
      /** True for the short hero/CTA capture, which persists as a DRAFT. */
      draft: boolean;
    }
  /**
   * Rule 16 / §7.2: the address belongs to a registered account and this caller
   * has not proved they control it, so nothing was attached — and the claim link
   * that lets them attach is on its way. "Check your email", never "your request
   * is in".
   */
  | {
      kind: "claim_sent";
      buyerOpportunityId: string;
      message: string;
    }
  /**
   * Captured as a lead and nothing more: no VehicleRequest, and no claim link
   * either — a registered address whose account has no buyer row, or too little
   * information to identify anyone. Operations is told (§26 BUYER_UNVERIFIED);
   * the visitor must not be shown a completed request or counted as a conversion.
   */
  | {
      kind: "held";
      buyerOpportunityId: string;
      message: string;
    };

const CLAIM_SENT_FALLBACK =
  "That address already has an AutoLenis account. For your security we sent a link there rather than adding this request to it.";
const HELD_FALLBACK =
  "We saved what you sent and a member of our team will follow up shortly.";

interface IntakeResponseBody {
  success?: boolean;
  buyerOpportunityId?: string | null;
  vehicleRequestId?: string | null;
  requiresClaim?: boolean;
  claimLinkSent?: boolean;
  draft?: boolean;
  message?: string | null;
  error?: { code?: string; message?: string };
  correlationId?: string;
}

/**
 * Turn a 200 body into the outcome. Exported for the tests that pin each branch;
 * call sites use `submitVehicleRequest`.
 *
 * Order matters. `vehicleRequestId` is checked FIRST because `requiresClaim` is
 * true for guest captures that did persist — branching on the flag first is the
 * defect this function exists to make unrepresentable.
 */
export function classifyIntakeResponse(raw: unknown): IntakeOutcome {
  const body = (raw ?? {}) as IntakeResponseBody;
  const opportunityId = body.buyerOpportunityId;
  if (typeof opportunityId !== "string" || opportunityId.length === 0) {
    // A 200 with no lead id is not a success we can describe. Failing here is
    // better than rendering a confirmation for a submission we cannot account for.
    throw new ApiError(
      "INTAKE_CONTRACT",
      "We could not confirm your request was saved. Please try again.",
      200,
      body.correlationId,
    );
  }

  if (typeof body.vehicleRequestId === "string" && body.vehicleRequestId.length > 0) {
    return {
      kind: "persisted",
      vehicleRequestId: body.vehicleRequestId,
      buyerOpportunityId: opportunityId,
      draft: body.draft === true,
    };
  }

  // Nothing attached. The link is the only thing that separates "check your
  // email" from "we are looking into it", and the server reports it explicitly —
  // an older server that does not send `claimLinkSent` is read as NOT sent, which
  // is the safe direction: it promises the visitor less, not more.
  if (body.requiresClaim === true && body.claimLinkSent === true) {
    return { kind: "claim_sent", buyerOpportunityId: opportunityId, message: body.message ?? CLAIM_SENT_FALLBACK };
  }
  return { kind: "held", buyerOpportunityId: opportunityId, message: body.message ?? HELD_FALLBACK };
}

/**
 * Submit to the ONE public intake handler and get back what happened.
 *
 * Throws `ApiError` for a transport failure or a non-2xx — the caller shows
 * `apiErrorMessage(err)`. It never returns a "success" a caller has to interpret.
 */
export async function submitVehicleRequest(
  payload: Record<string, unknown>,
  opts: { preApprovalFile?: File | null } = {},
): Promise<IntakeOutcome> {
  const file = opts.preApprovalFile;
  let res: Response;
  if (file) {
    // The multipart shape the route reads: the whole payload as one `data` field.
    const fd = new FormData();
    fd.append("data", JSON.stringify(payload));
    fd.append("preApprovalFile", file);
    res = await fetch("/api/public/request-vehicle", { method: "POST", body: fd });
  } else {
    res = await fetch("/api/public/request-vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  // An error page is not always JSON.
  const body = (await res.json().catch(() => null)) as IntakeResponseBody | null;
  if (!res.ok || body?.success !== true) {
    throw new ApiError(
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? "We could not save that just now. Try again in a moment.",
      res.status,
      body?.correlationId,
    );
  }
  return classifyIntakeResponse(body);
}

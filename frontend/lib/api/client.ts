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
  constructor(code: string, message: string, status: number, correlationId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
  }
}

type SuccessEnvelope<T> = { success: true; data: T };
type ErrorEnvelope = { error?: { code?: string; message?: string }; correlationId?: string };

async function parse<T>(res: Response): Promise<T> {
  // Some routes return an empty body on error paths; tolerate that.
  const body = (await res.json().catch(() => null)) as (SuccessEnvelope<T> & ErrorEnvelope) | null;

  if (!res.ok || !body || body.success !== true) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const message = body?.error?.message ?? "Something went wrong. Please try again.";
    throw new ApiError(code, message, res.status, body?.correlationId);
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

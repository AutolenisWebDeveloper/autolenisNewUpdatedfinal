import 'server-only';
import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase-service';
import { prisma } from '@/lib/prisma';
import { resolveDuplicateDispatch } from '@/lib/crm/dispatch-idempotency';
import { decideDispatchAuth } from '@/lib/crm/dispatch-auth-decision';

// ---------------------------------------------------------------------------
// INBOUND DISPATCH AUTH (Step 4 — shared middleware)
// ---------------------------------------------------------------------------
// Every /api/crm/dispatch/* endpoint is called by Make.com to ACT. This module
// is the single gate in front of those handlers:
//   - Auth (two paths, see dispatch-auth-decision.ts):
//       1. X-AutoLenis-Signature → HMAC-SHA256 over the RAW body (PRIMARY, for
//          code callers; constant-time compare; unchanged).
//       2. X-Dispatch-Key → constant-time compare against CRM_DISPATCH_KEY (for
//          Make's no-code plain-HTTP module). The two secrets are independent.
//     Every protection below applies to BOTH paths unchanged.
//   - Replay protection: reject timestamp skew > 5 minutes.
//   - DB-level idempotency on X-Idempotency-Key (reuses the Supabase
//     `idempotency_keys` table — sha256 PK, 23505 ⇒ duplicate). A duplicate
//     returns the PRIOR stored result instead of re-acting.
//   - Light per-secret rate limit (reuses the Prisma RateLimitEvent table).

const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 240; // per endpoint per window — light guard, not a quota
// Single shared dispatch identity (one CRM_DISPATCH_SECRET). Kept stable so the
// rate-limit bucket is per-endpoint for the Make integration as a whole.
const RATE_LIMIT_IDENTIFIER = 'crm_dispatch';

function unauthorized(reason: string): NextResponse {
  return NextResponse.json({ status: 'unauthorized', error: reason }, { status: 401 });
}

export type DispatchAuthResult =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      duplicate: true;
      priorResult: Record<string, unknown>;
      supabase: SupabaseClient;
    }
  | {
      ok: true;
      duplicate: false;
      body: Record<string, unknown>;
      idempotencyKey: string;
      keyHash: string;
      supabase: SupabaseClient;
    };

// Verify signature + replay + rate limit + idempotency. On success with a fresh
// key, the caller does its work and MUST call finalizeDispatch() to persist the
// result so a later retry returns it verbatim.
export async function authorizeDispatch(
  request: NextRequest,
  endpoint: string,
): Promise<DispatchAuthResult> {
  // Read the RAW body once — the HMAC is computed over these exact bytes, and
  // the handler parses JSON from the same string (a request body is single-use).
  const rawBody = await request.text();

  // Auth decision (precedence: HMAC signature → static dispatch key → none).
  // The HMAC path is unchanged and remains primary for code callers; the
  // static-key path lets Make use a plain HTTP module without client-side
  // signing. CRM_DISPATCH_SECRET (HMAC) and CRM_DISPATCH_KEY (static) are
  // independent — neither weakens the other.
  const decision = decideDispatchAuth({
    signatureHeader: request.headers.get('x-autolenis-signature'),
    dispatchKeyHeader: request.headers.get('x-dispatch-key'),
    rawBody,
    hmacSecret: process.env.CRM_DISPATCH_SECRET,
    staticKey: process.env.CRM_DISPATCH_KEY,
  });
  if (!decision.ok) {
    if (decision.reason === 'dispatch_not_configured') {
      console.error(
        '[dispatch-auth] no usable dispatch credential configured for the presented header — refusing call',
      );
    }
    return { ok: false, response: unauthorized(decision.reason) };
  }

  // Replay protection.
  const tsHeader = request.headers.get('x-autolenis-timestamp');
  const ts = Number(tsHeader);
  if (!tsHeader || Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return { ok: false, response: unauthorized('timestamp_skew') };
  }

  // Idempotency key — header preferred; fall back to body.idempotencyKey.
  let body: Record<string, unknown>;
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ status: 'bad_request', error: 'invalid_json' }, { status: 400 }),
    };
  }

  const idempotencyKey =
    request.headers.get('x-idempotency-key') ?? (body.idempotencyKey as string | undefined) ?? '';
  if (!idempotencyKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { status: 'bad_request', error: 'missing_idempotency_key' },
        { status: 400 },
      ),
    };
  }

  const supabase = getServiceSupabase();

  // Light rate limit (per endpoint, shared secret). Best-effort — a failure of
  // the limiter must not block legitimate dispatches.
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await prisma.rateLimitEvent.count({
      where: {
        identifier: RATE_LIMIT_IDENTIFIER,
        endpoint,
        hitAt: { gte: windowStart },
      },
    });
    if (recent >= RATE_LIMIT_MAX) {
      return {
        ok: false,
        response: NextResponse.json(
          { status: 'rate_limited', error: 'too_many_dispatches' },
          { status: 429 },
        ),
      };
    }
    await prisma.rateLimitEvent.create({
      data: { identifier: RATE_LIMIT_IDENTIFIER, endpoint },
    });
  } catch (err) {
    console.error('[dispatch-auth] rate-limit check failed (allowing):', err);
  }

  // DB-level idempotency. Insert sha256(key); 23505 ⇒ a prior call owns it.
  const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  const { error: insertError } = await supabase
    .from('idempotency_keys')
    .insert({ key_hash: keyHash, execution_status: 'processing' });

  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      // Duplicate key — a prior request owns this idempotency key. Branch on the
      // stored execution_status so a near-simultaneous retry is resolved by
      // STATE, never by handing back the (still-null) payload of an in-flight
      // request as if it were the completed result.
      const { data: prior } = await supabase
        .from('idempotency_keys')
        .select('execution_status, response_payload')
        .eq('key_hash', keyHash)
        .maybeSingle();

      const decision = resolveDuplicateDispatch(
        prior?.execution_status as string | undefined,
      );

      if (decision === 'replay') {
        // The original finished — replay its stored result verbatim.
        return {
          ok: true,
          duplicate: true,
          priorResult: (prior?.response_payload as Record<string, unknown>) ?? {},
          supabase,
        };
      }

      if (decision === 'reclaim') {
        // The original attempt did NOT succeed. Treat as not-yet-done: reclaim
        // the key (back to 'processing', clear any stale payload) and let the
        // caller re-act so the retry can actually complete the work.
        await supabase
          .from('idempotency_keys')
          .update({ execution_status: 'processing', response_payload: null })
          .eq('key_hash', keyHash);
        return { ok: true, duplicate: false, body, idempotencyKey, keyHash, supabase };
      }

      // decision === 'reject' — the original is still in flight. Returning its
      // null payload as a 200 would read as a successful empty result; instead
      // tell the caller to retry once the original settles (409, retryable).
      return {
        ok: false,
        response: NextResponse.json(
          { status: 'processing', error: 'dispatch_in_flight', retryable: true },
          { status: 409 },
        ),
      };
    }
    // Unexpected store error — fail closed with 500 rather than risk a
    // non-idempotent double-send.
    console.error('[dispatch-auth] idempotency insert failed:', insertError);
    return {
      ok: false,
      response: NextResponse.json(
        { status: 'error', error: 'idempotency_store_unavailable' },
        { status: 500 },
      ),
    };
  }

  return { ok: true, duplicate: false, body, idempotencyKey, keyHash, supabase };
}

// Persist the handler's result against the idempotency key so a retry of the
// same X-Idempotency-Key returns it verbatim. Best-effort.
export async function finalizeDispatch(
  supabase: SupabaseClient,
  keyHash: string,
  result: Record<string, unknown>,
  status: 'completed' | 'failed' = 'completed',
): Promise<void> {
  try {
    await supabase
      .from('idempotency_keys')
      .update({ execution_status: status, response_payload: result })
      .eq('key_hash', keyHash);
  } catch (err) {
    console.error('[dispatch-auth] finalize failed:', err);
  }
}

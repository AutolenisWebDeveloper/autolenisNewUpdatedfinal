import 'server-only';
import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase-service';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// INBOUND DISPATCH AUTH (Step 4 — shared middleware)
// ---------------------------------------------------------------------------
// Every /api/crm/dispatch/* endpoint is called by Make.com to ACT. This module
// is the single gate in front of those handlers:
//   - HMAC-SHA256 signature over the RAW body (constant-time compare).
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

function timingSafeEqualHex(a: string, b: string): boolean {
  // Hash both sides to fixed length first so timingSafeEqual never throws on a
  // length mismatch (which would itself leak length via the exception path).
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

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
  const secret = process.env.CRM_DISPATCH_SECRET;
  if (!secret) {
    console.error('[dispatch-auth] CRM_DISPATCH_SECRET unset — refusing all dispatch calls');
    return { ok: false, response: unauthorized('dispatch_not_configured') };
  }

  // Read the RAW body once — signature is computed over these exact bytes, and
  // the handler parses JSON from the same string (a request body is single-use).
  const rawBody = await request.text();

  const signature = request.headers.get('x-autolenis-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!signature || !timingSafeEqualHex(signature, expected)) {
    return { ok: false, response: unauthorized('bad_signature') };
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
      // Duplicate — return the prior result (may be {} if the original is still
      // processing; either way we never re-act).
      const { data: prior } = await supabase
        .from('idempotency_keys')
        .select('response_payload')
        .eq('key_hash', keyHash)
        .maybeSingle();
      return {
        ok: true,
        duplicate: true,
        priorResult: (prior?.response_payload as Record<string, unknown>) ?? {},
        supabase,
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

// app/api/crm/reconcile/run/route.ts
// PHASE A — NLLB reconciliation sweep. Make scenario 5412069 (daily cron) pokes
// this; it finds uncovered contacts and enrolls each into re-engagement by
// forwarding a SIGNED 'reengagement_sweep' envelope to the Router (MAKE_WEBHOOK_URL),
// reusing the exact outbound signer (lib/events/make-webhook.ts).
//
// Auth: accepts EITHER X-Dispatch-Key == CRM_DISPATCH_KEY (brief contract) OR
//   Authorization: Bearer CRON_SECRET (repo cron convention). Constant-time compare.
// Body: { job?: string, dry_run?: boolean, stale_days?: number }
// Returns: { uncovered_found, enrolled, dry_run, job }
//
// IRON RULE preserved: this NEVER sends email/SMS. It only emits enrollment
// events to the Router; the Processor later calls /api/crm/dispatch/* to send.

import { NextResponse, type NextRequest } from 'next/server';
import 'server-only';
import { getServiceSupabase } from '@/lib/supabase-service';
import { forwardToMake } from '@/lib/events/make-webhook';
import { timingSafeStrEqual } from '@/lib/crm/dispatch-auth-decision';
import {
  isUncovered,
  buildReengageEnvelope,
  type ReconcileContactState,
} from '@/lib/crm/reconcile-selection';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const DEFAULT_STALE_DAYS = 30;
const MAX_ENROLL_PER_RUN = 500; // safety cap; cron re-runs drain the rest.

function authorized(request: NextRequest): boolean {
  const dispatchKey = request.headers.get('x-dispatch-key');
  const expectedKey = process.env.CRM_DISPATCH_KEY;
  if (dispatchKey && expectedKey && timingSafeStrEqual(dispatchKey, expectedKey)) return true;

  const authz = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (authz && cronSecret && timingSafeStrEqual(authz, `Bearer ${cronSecret}`)) return true;

  return false;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  }

  let body: { job?: string; dry_run?: boolean; stale_days?: number } = {};
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ status: 'bad_request', error: 'invalid_json' }, { status: 400 });
  }

  const job = body.job ?? 'nllb_daily';
  const dryRun = body.dry_run === true;
  const staleDays = Number.isFinite(body.stale_days) ? Number(body.stale_days) : DEFAULT_STALE_DAYS;
  const now = new Date();

  const supabase = getServiceSupabase();

  // Coarse DB filter (matches idx_contacts_nurture_coverage); the pure predicate
  // re-checks each row so SQL and tests share ONE rule (reconcile-selection.ts).
  const cutoffIso = new Date(now.getTime() - staleDays * 86_400_000).toISOString();
  const { data: rows, error } = await supabase
    .from('contacts')
    .select(
      'id,email,phone,first_name,last_name,consent_email,consent_sms,lifecycle_stage,do_not_contact,deleted_at,nurture_status,last_contacted_at,created_at',
    )
    .is('deleted_at', null)
    .eq('do_not_contact', false)
    .not('nurture_status', 'in', '("active","reengagement","suppressed")')
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoffIso}`)
    .limit(MAX_ENROLL_PER_RUN);

  if (error) {
    logger.error('[reconcile/run] contact query failed:', error);
    return NextResponse.json({ status: 'error', error: 'query_failed' }, { status: 500 });
  }

  const candidates = (rows ?? []).filter((r) =>
    isUncovered(r as unknown as ReconcileContactState, { now, staleDays }),
  );

  let enrolled = 0;
  if (!dryRun) {
    for (const r of candidates) {
      try {
        await forwardToMake(
          buildReengageEnvelope(
            {
              id: r.id as string,
              email: (r.email as string | null) ?? null,
              phone: (r.phone as string | null) ?? null,
              firstName: (r.first_name as string | null) ?? null,
              lastName: (r.last_name as string | null) ?? null,
              consentEmail: Boolean(r.consent_email),
              consentSms: Boolean(r.consent_sms),
              lifecycleStage: (r.lifecycle_stage as string) ?? 'lead',
            },
            { now, staleDays, job },
          ) as Parameters<typeof forwardToMake>[0],
        );
        // Optimistic local mirror so the next sweep doesn't re-enroll the same
        // contact before Make confirms (Make may also set 'reengagement').
        await supabase
          .from('contacts')
          .update({ nurture_status: 'reengagement', updated_at: now.toISOString() })
          .eq('id', r.id);
        enrolled += 1;
      } catch (err) {
        logger.error(`[reconcile/run] enroll failed for ${r.id}:`, err);
      }
    }
  }

  logger.info(
    `[reconcile/run] job=${job} dry_run=${dryRun} found=${candidates.length} enrolled=${enrolled}`,
  );
  return NextResponse.json({
    status: 'ok',
    job,
    dry_run: dryRun,
    uncovered_found: candidates.length,
    enrolled,
    capped: candidates.length >= MAX_ENROLL_PER_RUN,
  });
}

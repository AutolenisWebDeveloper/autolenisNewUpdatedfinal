// app/api/admin/crm/coverage/route.ts
// PHASE F — read-side of the No Lead Left Behind KPI. Returns the coverage
// summary (uncovered count + 4-state breakdown) for the admin dashboard.
// Admin-authenticated; service-role Supabase counts only (no PII returned).

import { NextRequest } from 'next/server';
import { getAdminFromRequest, adminSuccess, adminError } from '@/lib/auth/admin-api';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getCoverageSummary, DEFAULT_STALE_DAYS } from '@/lib/crm/coverage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError('UNAUTHORIZED', 'Not authenticated', 401);

  const raw = new URL(request.url).searchParams.get('stale_days');
  const parsed = raw === null ? DEFAULT_STALE_DAYS : Number(raw);
  const staleDays = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_DAYS;

  try {
    const summary = await getCoverageSummary(getServiceSupabase(), { staleDays });
    return adminSuccess(summary);
  } catch (err) {
    return adminError(
      'COVERAGE_FAILED',
      err instanceof Error ? err.message : 'Failed to compute coverage',
      500,
    );
  }
}

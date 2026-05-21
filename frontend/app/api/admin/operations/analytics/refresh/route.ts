import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

// Manually trigger the matview refresh outside of the 2am cron — used when
// an admin wants to see today's funnel numbers without waiting for the next
// scheduled run. Safe to invoke at any cadence: REFRESH CONCURRENTLY does
// not block readers and is itself a no-op replay if no rows changed.
export async function POST() {
  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('refresh_analytics_views');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, refreshed_at: new Date().toISOString() });
}

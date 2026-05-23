import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService, normalizeConditions } from '@/lib/services/segment.service';
import { getAdminActor } from '@/lib/auth/admin-actor';

export const dynamic = 'force-dynamic';

// Live-count endpoint hit by the segment builder while the admin edits rules.
// Read-only — no audit log entry.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: { conditions: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  let conditions;
  try {
    conditions = normalizeConditions(body.conditions);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CONDITIONS_INVALID';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  try {
    const count = await SegmentService.countContacts(supabase, conditions);
    return NextResponse.json({ count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PREVIEW_FAILED';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

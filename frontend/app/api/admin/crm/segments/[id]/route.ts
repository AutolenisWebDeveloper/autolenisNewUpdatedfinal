import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService } from '@/lib/services/segment.service';
import { requirePermissionActor } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requirePermissionActor("crm.read");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  const supabase = getServiceSupabase();
  const segment = await SegmentService.getSegment(supabase, id);
  if (!segment) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ segment });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { name?: string; description?: string | null; conditions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const actor = await requirePermissionActor("crm.manage");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  try {
    const segment = await SegmentService.updateSegment(supabase, id, body, actor);
    return NextResponse.json({ segment });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UPDATE_FAILED';
    const status = message === 'SEGMENT_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

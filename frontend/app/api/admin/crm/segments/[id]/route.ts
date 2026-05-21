import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService } from '@/lib/services/segment.service';
import { getAdminActorId } from '@/lib/auth/admin-actor';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const supabase = getServiceSupabase();
  const adminId = await getAdminActorId();

  try {
    const segment = await SegmentService.updateSegment(supabase, id, body, adminId);
    return NextResponse.json({ segment });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UPDATE_FAILED';
    const status = message === 'SEGMENT_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

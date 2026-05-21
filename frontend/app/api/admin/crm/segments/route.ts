import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService } from '@/lib/services/segment.service';
import { getAdminActorId } from '@/lib/auth/admin-actor';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServiceSupabase();
  try {
    const segments = await SegmentService.listSegments(supabase);
    return NextResponse.json({ data: segments });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'LIST_FAILED';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { name: string; description?: string | null; conditions: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const adminId = await getAdminActorId();

  try {
    const segment = await SegmentService.createSegment(supabase, body, adminId);
    return NextResponse.json({ segment }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CREATE_FAILED';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

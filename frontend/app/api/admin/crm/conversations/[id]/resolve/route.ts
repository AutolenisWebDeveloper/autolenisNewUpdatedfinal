import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from('conversations')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

import { notFound } from 'next/navigation';
import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService } from '@/lib/services/segment.service';
import { SegmentBuilder } from '@/components/admin/crm/SegmentBuilder';

export const dynamic = 'force-dynamic';

export default async function EditSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceSupabase();
  const segment = await SegmentService.getSegment(supabase, id);
  if (!segment) notFound();
  return <SegmentBuilder mode="edit" segment={segment} />;
}

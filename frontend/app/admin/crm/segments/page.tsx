import { getServiceSupabase } from '@/lib/supabase-service';
import { SegmentService } from '@/lib/services/segment.service';
import type { Segment } from '@/lib/types/crm';
import { SegmentListClient } from '@/components/admin/crm/SegmentListClient';

export const dynamic = 'force-dynamic';

export default async function SegmentsPage() {
  const supabase = getServiceSupabase();
  let segments: Segment[] = [];
  let loadError: string | null = null;
  try {
    segments = await SegmentService.listSegments(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'LOAD_FAILED';
  }

  return <SegmentListClient segments={segments} loadError={loadError} />;
}

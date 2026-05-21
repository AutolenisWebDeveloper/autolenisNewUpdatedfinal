import { NextResponse } from 'next/server';
import { PREBUILT_WORKFLOWS } from '@/lib/services/workflow.prebuilt';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    data: PREBUILT_WORKFLOWS.map((p) => ({
      key: p.key,
      category: p.category,
      name: p.name,
      description: p.description,
      trigger_type: p.trigger_type,
      node_count: p.graph.nodes.length,
    })),
  });
}

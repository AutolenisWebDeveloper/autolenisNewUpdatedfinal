import Link from 'next/link';
import { Plus, Zap } from 'lucide-react';
import { getServiceSupabase } from '@/lib/supabase-service';
import { WorkflowService } from '@/lib/services/workflow.service';
import { PREBUILT_WORKFLOWS } from '@/lib/services/workflow.prebuilt';
import { WorkflowListClient } from '@/components/admin/crm/WorkflowList';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const supabase = getServiceSupabase();
  const workflows = await WorkflowService.listWorkflows(supabase, {});
  const stats = await WorkflowService.getStatsForWorkflows(
    supabase,
    workflows.map((w) => w.id),
  );

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" />
            Workflows
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Visual automation engine — triggers, delays, conditions, actions.
          </p>
        </div>
        <Link
          href="/admin/crm/automations/new"
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Workflow
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <WorkflowListClient
          initialWorkflows={workflows}
          initialStats={stats}
          prebuilt={PREBUILT_WORKFLOWS.map((p) => ({
            key: p.key,
            category: p.category,
            name: p.name,
            description: p.description,
            trigger_type: p.trigger_type,
            node_count: p.graph.nodes.length,
          }))}
        />
      </div>
    </div>
  );
}

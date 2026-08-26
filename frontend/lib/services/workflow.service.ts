import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Workflow,
  WorkflowGraph,
  WorkflowInput,
  WorkflowNode,
  WorkflowStatus,
  WorkflowTriggerType,
  WorkflowUpdate,
} from '@/lib/types/crm';
import { parseDurationToSeconds } from './workflow.engine';
import { writeCrmAuditLog, type CrmAuditActor } from './admin/crm-audit';

// Keep at most this many historical versions per workflow. Excess gets pruned
// on each save so the table stays small and the UI's "Version history" panel
// shows a meaningful slice (newest 10).
const MAX_RETAINED_VERSIONS = 10;

const TRIGGER_TYPES: WorkflowTriggerType[] = [
  'buyer_signup',
  'vehicle_request_submitted',
  'deposit_pending',
  'deposit_paid',
  'auction_started',
  'offer_received',
  'offer_selected',
  'contract_signed',
  'purchase_completed',
  'refinance_inquiry',
  'dealer_invited',
  'affiliate_signup',
  'buyer_inactive',
  'manual',
];

// Pre-activation validation. Drafts are allowed to have broken graphs so the
// admin can save work-in-progress; this only runs when status goes to active.
export function validateGraphForActivation(graph: WorkflowGraph): void {
  if (!graph.nodes || graph.nodes.length === 0) {
    throw new Error('GRAPH_EMPTY');
  }

  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  if (!trigger) throw new Error('GRAPH_NO_TRIGGER');

  const triggerCount = graph.nodes.filter((n) => n.type === 'trigger').length;
  if (triggerCount > 1) throw new Error('GRAPH_MULTIPLE_TRIGGERS');

  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`GRAPH_EDGE_DANGLING:${edge.from}->${edge.to}`);
    }
  }

  // Every non-trigger node must be reachable from the trigger. Walk the
  // graph; report orphans (saved nodes that never run are usually a sign of
  // a half-finished edit and worth blocking on).
  const reachable = new Set<string>([trigger.id]);
  const queue: string[] = [trigger.id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of graph.edges.filter((x) => x.from === cur)) {
      if (!reachable.has(e.to)) {
        reachable.add(e.to);
        queue.push(e.to);
      }
    }
  }
  const orphans = graph.nodes.filter((n) => !reachable.has(n.id));
  if (orphans.length > 0) {
    throw new Error(`GRAPH_ORPHAN_NODES:${orphans.map((n) => n.id).join(',')}`);
  }

  for (const node of graph.nodes) {
    validateNodeConfig(node);
  }

  // Condition nodes must have both true and false branches OR a single
  // unconditional successor that they share (which the engine accepts as
  // "branch defaults to next"). Enforce explicit branches so the operator
  // sees the path they built rather than silent fallthrough.
  for (const node of graph.nodes.filter((n) => n.type === 'condition')) {
    const outs = graph.edges.filter((e) => e.from === node.id);
    const branches = new Set(outs.map((e) => e.branch ?? 'none'));
    if (!branches.has('true') || !branches.has('false')) {
      throw new Error(`CONDITION_NODE_BRANCHES_INCOMPLETE:${node.id}`);
    }
  }
}

function validateNodeConfig(node: WorkflowNode): void {
  const cfg = node.config ?? {};
  switch (node.type) {
    case 'trigger':
      return;
    case 'condition':
      if (!cfg.field || !cfg.op) {
        throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      }
      return;
    case 'delay':
      if (!cfg.duration || typeof cfg.duration !== 'string') {
        throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      }
      // Throws on malformed duration — surfaces during activation rather than
      // at the first delay execution.
      parseDurationToSeconds(cfg.duration);
      return;
    case 'action.sendEmail':
      if (!cfg.template_id) throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      return;
    case 'action.sendSms':
      if (!cfg.body || typeof cfg.body !== 'string' || !cfg.body.trim()) {
        throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      }
      return;
    case 'action.createTask':
      if (!cfg.title || typeof cfg.title !== 'string' || !cfg.title.trim()) {
        throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      }
      return;
    case 'action.updateStage':
      if (!cfg.stage) throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      return;
    case 'action.assignAdmin':
      if (!cfg.admin_id) throw new Error(`NODE_CONFIG_INCOMPLETE:${node.id}`);
      return;
    case 'action.notifyAdmin':
      // admin_email defaults to env var at execution time — config is optional
      return;
    case 'action.endWorkflow':
      return;
    default:
      throw new Error(`UNKNOWN_NODE_TYPE:${node.id}`);
  }
}

export class WorkflowService {
  static readonly TRIGGER_TYPES = TRIGGER_TYPES;
  static readonly MAX_RETAINED_VERSIONS = MAX_RETAINED_VERSIONS;

  static async getWorkflow(supabase: SupabaseClient, id: string): Promise<Workflow | null> {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Workflow | null) ?? null;
  }

  static async listWorkflows(
    supabase: SupabaseClient,
    options: { status?: WorkflowStatus; search?: string } = {},
  ): Promise<Workflow[]> {
    let query = supabase
      .from('workflows')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200);

    if (options.status) query = query.eq('status', options.status);
    if (options.search) {
      const q = options.search.replace(/[%_]/g, '\\$&');
      query = query.ilike('name', `%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as Workflow[]) ?? [];
  }

  static async createWorkflow(
    supabase: SupabaseClient,
    input: WorkflowInput,
    actor: CrmAuditActor | null,
  ): Promise<Workflow> {
    if (!input.name?.trim()) throw new Error('NAME_REQUIRED');
    if (!input.trigger_type || !TRIGGER_TYPES.includes(input.trigger_type)) {
      throw new Error('TRIGGER_TYPE_INVALID');
    }

    const nodes: WorkflowGraph = input.nodes ?? { nodes: [], edges: [] };
    const adminId = actor?.adminId ?? null;

    const { data, error } = await supabase
      .from('workflows')
      .insert({
        name: input.name.trim(),
        description: input.description ?? null,
        trigger_type: input.trigger_type,
        trigger_config: input.trigger_config ?? {},
        nodes,
        status: 'draft',
        version: 1,
        is_prebuilt: !!input.is_prebuilt,
        prebuilt_key: input.prebuilt_key ?? null,
        created_by: adminId,
      })
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('workflow_versions').insert({
      workflow_id: data.id,
      version: 1,
      nodes,
      trigger_config: input.trigger_config ?? {},
      created_by: adminId,
    });

    await writeCrmAuditLog(supabase, actor, {
      action: 'CREATE_WORKFLOW',
      entity_type: 'workflow',
      entity_id: data.id,
      new_state: data,
    });

    return data as Workflow;
  }

  // Persist edits + snapshot the previous graph into workflow_versions before
  // overwriting. version bumps only when graph or trigger config changes —
  // pure metadata edits (name, description) keep the version number.
  static async updateWorkflow(
    supabase: SupabaseClient,
    id: string,
    update: WorkflowUpdate,
    actor: CrmAuditActor | null,
  ): Promise<Workflow> {
    const before = await this.getWorkflow(supabase, id);
    if (!before) throw new Error('WORKFLOW_NOT_FOUND');

    const graphChanged =
      (update.nodes !== undefined && JSON.stringify(update.nodes) !== JSON.stringify(before.nodes)) ||
      (update.trigger_config !== undefined &&
        JSON.stringify(update.trigger_config) !== JSON.stringify(before.trigger_config)) ||
      (update.trigger_type !== undefined && update.trigger_type !== before.trigger_type);

    if (graphChanged) {
      await supabase.from('workflow_versions').insert({
        workflow_id: id,
        version: before.version,
        nodes: before.nodes,
        trigger_config: before.trigger_config,
        created_by: before.created_by,
      });
      // Trim old versions so the table doesn't grow unbounded.
      await this.pruneVersionHistory(supabase, id);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (update.name !== undefined) patch.name = update.name;
    if (update.description !== undefined) patch.description = update.description;
    if (update.trigger_type !== undefined) patch.trigger_type = update.trigger_type;
    if (update.trigger_config !== undefined) patch.trigger_config = update.trigger_config;
    if (update.nodes !== undefined) patch.nodes = update.nodes;
    if (update.status !== undefined) patch.status = update.status;
    if (graphChanged) patch.version = before.version + 1;

    const { data, error } = await supabase
      .from('workflows')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    await writeCrmAuditLog(supabase, actor, {
      action: 'UPDATE_WORKFLOW',
      entity_type: 'workflow',
      entity_id: id,
      previous_state: before,
      new_state: data,
    });

    return data as Workflow;
  }

  // Activation flips status to 'active' after running the validator. Returning
  // the updated row lets the API surface the activated_at timestamp without a
  // second round trip.
  static async activateWorkflow(
    supabase: SupabaseClient,
    id: string,
    actor: CrmAuditActor | null,
  ): Promise<Workflow> {
    const wf = await this.getWorkflow(supabase, id);
    if (!wf) throw new Error('WORKFLOW_NOT_FOUND');
    validateGraphForActivation(wf.nodes);

    const { data, error } = await supabase
      .from('workflows')
      .update({
        status: 'active',
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    await writeCrmAuditLog(supabase, actor, {
      action: 'ACTIVATE_WORKFLOW',
      entity_type: 'workflow',
      entity_id: id,
      previous_state: { status: wf.status },
      new_state: { status: 'active' },
    });

    return data as Workflow;
  }

  static async setStatus(
    supabase: SupabaseClient,
    id: string,
    status: WorkflowStatus,
    actor: CrmAuditActor | null,
  ): Promise<Workflow> {
    if (status === 'active') return this.activateWorkflow(supabase, id, actor);

    const { data, error } = await supabase
      .from('workflows')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    await writeCrmAuditLog(supabase, actor, {
      action: 'UPDATE_WORKFLOW_STATUS',
      entity_type: 'workflow',
      entity_id: id,
      new_state: { status },
    });
    return data as Workflow;
  }

  static async listVersions(supabase: SupabaseClient, workflowId: string) {
    const { data, error } = await supabase
      .from('workflow_versions')
      .select('id, version, created_at, created_by')
      .eq('workflow_id', workflowId)
      .order('version', { ascending: false })
      .limit(MAX_RETAINED_VERSIONS);
    if (error) throw error;
    return data ?? [];
  }

  static async restoreVersion(
    supabase: SupabaseClient,
    workflowId: string,
    versionId: string,
    actor: CrmAuditActor | null,
  ): Promise<Workflow> {
    const { data: version } = await supabase
      .from('workflow_versions')
      .select('*')
      .eq('id', versionId)
      .eq('workflow_id', workflowId)
      .maybeSingle();
    if (!version) throw new Error('VERSION_NOT_FOUND');

    return this.updateWorkflow(
      supabase,
      workflowId,
      {
        nodes: version.nodes,
        trigger_config: version.trigger_config,
      },
      actor,
    );
  }

  static async duplicateWorkflow(
    supabase: SupabaseClient,
    id: string,
    actor: CrmAuditActor | null,
  ): Promise<Workflow> {
    const src = await this.getWorkflow(supabase, id);
    if (!src) throw new Error('WORKFLOW_NOT_FOUND');

    return this.createWorkflow(
      supabase,
      {
        name: `${src.name} (copy)`,
        description: src.description,
        trigger_type: src.trigger_type,
        trigger_config: src.trigger_config,
        nodes: src.nodes,
        is_prebuilt: false,
        prebuilt_key: null,
      },
      actor,
    );
  }

  static async deleteWorkflow(
    supabase: SupabaseClient,
    id: string,
    actor: CrmAuditActor | null,
  ): Promise<void> {
    const before = await this.getWorkflow(supabase, id);
    if (!before) return;
    // Archived workflows are kept; only drafts can be hard-deleted from the
    // UI. Anything else gets archived to preserve the enrollment history.
    if (before.status === 'draft') {
      await supabase.from('workflows').delete().eq('id', id);
    } else {
      await supabase
        .from('workflows')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', id);
    }
    await writeCrmAuditLog(supabase, actor, {
      action: before.status === 'draft' ? 'DELETE_WORKFLOW' : 'ARCHIVE_WORKFLOW',
      entity_type: 'workflow',
      entity_id: id,
      previous_state: before,
    });
  }

  // Counts for the workflow list card — quick aggregate so the UI doesn't
  // need to round-trip to enrollment endpoints for every row.
  static async getStatsForWorkflows(
    supabase: SupabaseClient,
    workflowIds: string[],
  ): Promise<Record<string, { active: number; completed: number; failed: number }>> {
    if (workflowIds.length === 0) return {};

    const { data } = await supabase
      .from('workflow_enrollments')
      .select('workflow_id, status')
      .in('workflow_id', workflowIds);

    const out: Record<string, { active: number; completed: number; failed: number }> = {};
    for (const id of workflowIds) out[id] = { active: 0, completed: 0, failed: 0 };
    for (const row of data ?? []) {
      const slot = out[row.workflow_id as string];
      if (!slot) continue;
      if (row.status === 'active' || row.status === 'paused') slot.active += 1;
      else if (row.status === 'completed') slot.completed += 1;
      else if (row.status === 'failed' || row.status === 'exited') slot.failed += 1;
    }
    return out;
  }

  private static async pruneVersionHistory(
    supabase: SupabaseClient,
    workflowId: string,
  ): Promise<void> {
    const { data } = await supabase
      .from('workflow_versions')
      .select('id, version')
      .eq('workflow_id', workflowId)
      .order('version', { ascending: false });

    const stale = (data ?? []).slice(MAX_RETAINED_VERSIONS);
    if (stale.length === 0) return;
    await supabase
      .from('workflow_versions')
      .delete()
      .in('id', stale.map((v) => v.id));
  }
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft,
  Play,
  Save,
  History,
  Plus,
  Trash2,
  GitBranch,
  Clock,
  Mail,
  MessageSquare,
  CheckSquare,
  ArrowRightCircle,
  Bell,
  StopCircle,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Zap,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  Workflow,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowStatus,
  WorkflowTriggerType,
} from '@/lib/types/crm';

interface TemplateOption {
  id: string;
  name: string;
  subject: string;
}

interface VersionMeta {
  id: string;
  version: number;
  created_at: string;
  created_by: string | null;
}

interface BuilderProps {
  templates: TemplateOption[];
  initialWorkflow: Workflow | null;
  versions?: VersionMeta[];
}

// Linear chain editor with explicit condition branches. Internally we keep an
// ordered list of "steps"; condition steps own two sub-chains (true / false).
// We materialize a WorkflowGraph (nodes + edges) at save time so the engine's
// graph contract stays exactly as documented in the schema.
type Step = {
  uid: string; // stable client-side id
  node: WorkflowNode;
  // Only present for condition nodes — sub-chains for each branch
  branches?: {
    true: Step[];
    false: Step[];
  };
};

const TRIGGER_OPTIONS: { value: WorkflowTriggerType; label: string; description: string }[] = [
  { value: 'buyer_signup', label: 'Buyer signup', description: 'When a new buyer account is created' },
  { value: 'vehicle_request_submitted', label: 'Vehicle request submitted', description: 'When a buyer submits a vehicle request' },
  { value: 'deposit_pending', label: 'Deposit pending', description: 'When a deposit intent is initiated' },
  { value: 'deposit_paid', label: 'Deposit paid', description: 'When Stripe confirms a deposit succeeded' },
  { value: 'auction_started', label: 'Auction started', description: 'When an auction goes live' },
  { value: 'offer_received', label: 'Offer received', description: 'When a dealer submits an offer' },
  { value: 'offer_selected', label: 'Offer selected', description: 'When a buyer selects a winning offer' },
  { value: 'docusign_signed', label: 'Contract signed', description: 'When DocuSign envelope is completed' },
  { value: 'purchase_completed', label: 'Purchase completed', description: 'When the deal is finalized' },
  { value: 'refinance_inquiry', label: 'Refinance inquiry', description: 'When a refi lead is captured' },
  { value: 'dealer_invited', label: 'Dealer invited', description: 'When a dealer joins the platform' },
  { value: 'affiliate_signup', label: 'Affiliate signup', description: 'When an affiliate account is created' },
  { value: 'buyer_inactive', label: 'Buyer inactive (72h)', description: 'Inactivity scanner — runs hourly' },
  { value: 'manual', label: 'Manual trigger only', description: 'Enroll via admin action — no auto trigger' },
];

const ADD_PALETTE: { type: WorkflowNodeType; label: string; icon: typeof Mail; description: string }[] = [
  { type: 'action.sendEmail',  label: 'Send Email',   icon: Mail,            description: 'Send a templated email' },
  { type: 'action.sendSms',    label: 'Send SMS',     icon: MessageSquare,   description: 'TCPA-gated SMS' },
  { type: 'delay',             label: 'Delay',        icon: Clock,           description: 'Wait before next step' },
  { type: 'condition',         label: 'Condition',    icon: GitBranch,       description: 'Branch true / false' },
  { type: 'action.createTask', label: 'Create Task',  icon: CheckSquare,     description: 'Add a CRM task' },
  { type: 'action.updateStage',label: 'Update Stage', icon: ArrowRightCircle,description: 'Change lifecycle stage' },
  { type: 'action.notifyAdmin',label: 'Notify Admin', icon: Bell,            description: 'Send an internal alert' },
  { type: 'action.endWorkflow',label: 'End Workflow', icon: StopCircle,      description: 'Terminate immediately' },
];

const LIFECYCLE_STAGES = [
  'lead', 'prequal_started', 'prequal_completed',
  'deposit_pending', 'deposit_paid', 'auction_active',
  'offer_received', 'purchase_completed', 'inactive',
];

const CONDITION_FIELDS = [
  { value: 'lifecycle_stage', label: 'Lifecycle stage', ops: ['eq', 'neq'] },
  { value: 'consent_sms', label: 'SMS consent', ops: ['is_true', 'is_false'] },
  { value: 'consent_email', label: 'Email consent', ops: ['is_true', 'is_false'] },
  { value: 'do_not_contact', label: 'Do not contact', ops: ['is_true', 'is_false'] },
  { value: 'source', label: 'Source', ops: ['eq', 'neq'] },
  { value: 'utm_source', label: 'UTM source', ops: ['eq', 'neq', 'contains'] },
  { value: 'utm_campaign', label: 'UTM campaign', ops: ['eq', 'neq', 'contains'] },
  { value: 'tags', label: 'Tags', ops: ['has_tag', 'not_has_tag'] },
] as const;

const OP_LABELS: Record<string, string> = {
  eq: 'equals',
  neq: 'does not equal',
  is_true: 'is true',
  is_false: 'is false',
  contains: 'contains',
  not_contains: 'does not contain',
  has_tag: 'has tag',
  not_has_tag: 'does not have tag',
};

const DELAY_PRESETS = [
  { value: '10m', label: '10 minutes' },
  { value: '1h',  label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '3d',  label: '3 days' },
  { value: '7d',  label: '7 days' },
];

// -----------------------------------------------------------------------
// Convert between flat WorkflowGraph and the nested Step[] used by the UI.
// The conversion is lossy in only one way: graph edges that re-merge after a
// condition (i.e. both branches converge on the same node) are duplicated in
// the UI so each branch ends with its own copy. This keeps the editor mental
// model strictly tree-shaped, which is easier for non-engineers to reason
// about than arbitrary DAG topologies.
// -----------------------------------------------------------------------

function genUid(): string {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

function graphToSteps(graph: WorkflowGraph): Step[] {
  // Pull out the trigger if present — it's rendered separately, never inside the chain.
  const triggerNode = graph.nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) return [];

  function buildChain(startId: string | undefined, visited: Set<string>): Step[] {
    if (!startId) return [];
    const chain: Step[] = [];
    let cursor: string | undefined = startId;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const node = graph.nodes.find((n) => n.id === cursor);
      if (!node) break;
      const step: Step = { uid: genUid(), node };

      if (node.type === 'condition') {
        const trueEdge = graph.edges.find((e) => e.from === node.id && e.branch === 'true');
        const falseEdge = graph.edges.find((e) => e.from === node.id && e.branch === 'false');
        step.branches = {
          true: buildChain(trueEdge?.to, new Set(visited)),
          false: buildChain(falseEdge?.to, new Set(visited)),
        };
        chain.push(step);
        return chain; // condition terminates the parent chain
      }

      chain.push(step);
      const next = graph.edges.find((e) => e.from === cursor && !e.branch);
      cursor = next?.to;
    }
    return chain;
  }

  const entryEdge = graph.edges.find((e) => e.from === triggerNode.id);
  return buildChain(entryEdge?.to, new Set([triggerNode.id]));
}

function stepsToGraph(triggerType: WorkflowTriggerType, steps: Step[]): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowGraph['edges'] = [];

  let yCursor = 80;
  function pos() {
    const y = yCursor;
    yCursor += 120;
    return { x: 280, y };
  }

  const triggerNode: WorkflowNode = {
    id: `trigger_${genUid()}`,
    type: 'trigger',
    config: { trigger_type: triggerType },
    position: pos(),
  };
  nodes.push(triggerNode);

  function walk(chain: Step[], parentId: string, branch?: 'true' | 'false') {
    let prev = parentId;
    let firstBranch = branch;
    for (const step of chain) {
      const node: WorkflowNode = {
        id: step.node.id.startsWith('trigger_') ? `n_${genUid()}` : (step.node.id || `n_${genUid()}`),
        type: step.node.type,
        config: step.node.config,
        position: pos(),
      };
      nodes.push(node);
      edges.push({ from: prev, to: node.id, branch: firstBranch });
      firstBranch = undefined;

      if (step.node.type === 'condition' && step.branches) {
        walk(step.branches.true, node.id, 'true');
        walk(step.branches.false, node.id, 'false');
        return; // condition ends the chain
      }
      prev = node.id;
    }
  }

  walk(steps, triggerNode.id);
  return { nodes, edges };
}

function defaultConfigFor(type: WorkflowNodeType): Record<string, unknown> {
  switch (type) {
    case 'delay':             return { duration: '1h' };
    case 'condition':         return { field: 'lifecycle_stage', op: 'eq', value: 'lead' };
    case 'action.sendEmail':  return { email_type: 'transactional' };
    case 'action.sendSms':    return { body: '' };
    case 'action.createTask': return { title: '', priority: 'medium', due_in_hours: 24 };
    case 'action.updateStage':return { stage: 'lead' };
    case 'action.notifyAdmin':return { subject: '', message: '' };
    default:                  return {};
  }
}

function nodeIcon(type: WorkflowNodeType) {
  const entry = ADD_PALETTE.find((p) => p.type === type);
  return entry?.icon ?? Zap;
}

function nodeLabel(type: WorkflowNodeType): string {
  const entry = ADD_PALETTE.find((p) => p.type === type);
  return entry?.label ?? type;
}

function summarizeNode(node: WorkflowNode, templates: TemplateOption[]): string {
  const c = node.config ?? {};
  switch (node.type) {
    case 'delay':
      return `Wait ${c.duration ?? '?'}`;
    case 'condition':
      return `If ${c.field ?? '?'} ${OP_LABELS[c.op as string] ?? c.op ?? '?'} ${c.value !== undefined && c.value !== null ? `"${c.value}"` : ''}`;
    case 'action.sendEmail': {
      const t = templates.find((x) => x.id === c.template_id);
      if (c.template_slug && !c.template_id) return `Template needed (was: ${c.template_slug})`;
      return t ? `Send template "${t.name}"` : c.template_id ? 'Send email' : 'No template selected';
    }
    case 'action.sendSms':
      return c.body ? `SMS: "${String(c.body).slice(0, 60)}${String(c.body).length > 60 ? '…' : ''}"` : 'No SMS body';
    case 'action.createTask':
      return c.title ? `Task: "${c.title}"` : 'No task title';
    case 'action.updateStage':
      return `Set stage → ${c.stage ?? '?'}`;
    case 'action.notifyAdmin':
      return c.subject ? `Notify admin — "${c.subject}"` : 'Notify admin';
    case 'action.endWorkflow':
      return 'End workflow';
    case 'trigger':
      return 'Trigger';
    default:
      return node.type;
  }
}

// ----------------------------------------------------------------------------
// COMPONENT
// ----------------------------------------------------------------------------

export function WorkflowBuilder({
  templates,
  initialWorkflow,
  versions: initialVersions = [],
}: BuilderProps) {
  const router = useRouter();
  const isNew = !initialWorkflow;

  const [name, setName] = useState(initialWorkflow?.name ?? 'Untitled Workflow');
  const [description, setDescription] = useState(initialWorkflow?.description ?? '');
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>(
    initialWorkflow?.trigger_type ?? 'buyer_signup',
  );
  const [steps, setSteps] = useState<Step[]>(() =>
    initialWorkflow ? graphToSteps(initialWorkflow.nodes) : [],
  );
  const [status, setStatus] = useState<WorkflowStatus>(initialWorkflow?.status ?? 'draft');
  const [workflowId, setWorkflowId] = useState<string | null>(initialWorkflow?.id ?? null);
  const [version, setVersion] = useState<number>(initialWorkflow?.version ?? 1);
  const [versions, setVersions] = useState<VersionMeta[]>(initialVersions);

  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-save every 30 seconds when dirty. saveRef holds the latest save
  // closure so the interval callback always invokes the current version
  // without re-subscribing on every render.
  const dirtyRef = useRef(false);
  const saveRef = useRef<((opts?: { silent?: boolean }) => Promise<Workflow | null>) | null>(null);
  useEffect(() => {
    dirtyRef.current = true;
  }, [name, description, triggerType, steps]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (dirtyRef.current && workflowId && saveRef.current) {
        saveRef.current({ silent: true });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [workflowId]);

  // -- Step mutation helpers (path = list of indices through nested branches) --
  function mutateAtPath(
    path: string[],
    mutate: (list: Step[]) => Step[],
  ) {
    setSteps((prev) => {
      function recurse(list: Step[], remaining: string[]): Step[] {
        if (remaining.length === 0) return mutate(list);
        const [head, ...rest] = remaining;
        const [indexStr, branch] = head.split(':');
        const idx = Number(indexStr);
        return list.map((s, i) => {
          if (i !== idx) return s;
          if (!s.branches || (branch !== 'true' && branch !== 'false')) return s;
          return {
            ...s,
            branches: {
              ...s.branches,
              [branch]: recurse(s.branches[branch], rest),
            },
          };
        });
      }
      return recurse(prev, path);
    });
  }

  function addStep(parentPath: string[], type: WorkflowNodeType, insertAt: number) {
    const node: WorkflowNode = {
      id: `n_${genUid()}`,
      type,
      config: defaultConfigFor(type),
    };
    const step: Step = { uid: genUid(), node };
    if (type === 'condition') {
      step.branches = { true: [], false: [] };
    }
    mutateAtPath(parentPath, (list) => {
      const next = [...list];
      next.splice(insertAt, 0, step);
      return next;
    });
  }

  function removeStep(parentPath: string[], idx: number) {
    mutateAtPath(parentPath, (list) => list.filter((_, i) => i !== idx));
    setSelectedPath(null);
  }

  function updateStep(parentPath: string[], idx: number, patch: Partial<WorkflowNode>) {
    mutateAtPath(parentPath, (list) =>
      list.map((s, i) =>
        i === idx
          ? { ...s, node: { ...s.node, ...patch, config: { ...s.node.config, ...(patch.config ?? {}) } } }
          : s,
      ),
    );
  }

  function getStepAtPath(path: string[] | null): { step: Step; parentPath: string[]; idx: number } | null {
    if (!path) return null;
    let list = steps;
    let parentPath: string[] = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const [indexStr, branch] = path[i].split(':');
      const idx = Number(indexStr);
      const s = list[idx];
      if (!s?.branches || (branch !== 'true' && branch !== 'false')) return null;
      list = s.branches[branch];
      parentPath = path.slice(0, i + 1);
    }
    const last = path[path.length - 1];
    const idx = Number(last.split(':')[0]);
    const step = list[idx];
    return step ? { step, parentPath, idx } : null;
  }

  const selected = useMemo(() => getStepAtPath(selectedPath), [selectedPath, steps]);

  // -- Save / activate / restore -------------------------------------------
  async function save(opts: { silent?: boolean } = {}): Promise<Workflow | null> {
    setSaving(true);
    setError(null);
    try {
      const graph = stepsToGraph(triggerType, steps);
      const payload = {
        name,
        description,
        trigger_type: triggerType,
        nodes: graph,
      };

      let res: Response;
      if (!workflowId) {
        res = await fetch('/api/admin/crm/automations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/admin/crm/automations/${workflowId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Save failed');
        return null;
      }
      const wf = json.workflow as Workflow;
      setWorkflowId(wf.id);
      setVersion(wf.version);
      setStatus(wf.status);
      setSavedAt(new Date());
      dirtyRef.current = false;
      if (!opts.silent && !workflowId) {
        // First save → swap URL to /edit so refreshes keep the workflow.
        router.replace(`/admin/crm/automations/${wf.id}/edit`);
      }
      return wf;
    } finally {
      setSaving(false);
    }
  }

  // Keep saveRef in sync so the autosave interval invokes the latest closure.
  saveRef.current = save;

  async function activate() {
    setActivating(true);
    setError(null);
    try {
      const wf = await save({ silent: true });
      if (!wf) return;
      const res = await fetch(`/api/admin/crm/automations/${wf.id}/activate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Activation failed');
        return;
      }
      setStatus(json.workflow.status);
    } finally {
      setActivating(false);
    }
  }

  async function pause() {
    if (!workflowId) return;
    setActivating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/automations/${workflowId}/pause`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Pause failed');
        return;
      }
      setStatus(json.workflow.status);
    } finally {
      setActivating(false);
    }
  }

  // ----------------------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur px-6 py-3 flex items-center gap-4">
        <Link
          href="/admin/crm/automations"
          className="text-gray-500 hover:text-gray-400 flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="w-4 h-4" />
          Workflows
        </Link>

        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent text-base font-semibold text-gray-900 outline-none focus:bg-white px-2 py-1 rounded -mx-2 w-full max-w-md"
          />
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded border uppercase text-[10px] font-semibold',
                status === 'active' && 'bg-emerald-50 text-emerald-700 border-emerald-500/30',
                status === 'draft' && 'bg-gray-700/40 text-gray-400 border-gray-300',
                status === 'paused' && 'bg-yellow-50 text-yellow-700 border-yellow-200',
                status === 'archived' && 'bg-gray-700/30 text-gray-500 border-gray-200',
              )}
            >
              {status}
            </span>
            <span>v{version}</span>
            {savedAt && (
              <>
                <span>·</span>
                <span>Saved {savedAt.toLocaleTimeString()}</span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHistory((s) => !s)}
          className="border border-gray-300 hover:border-gray-400 text-gray-500 text-sm px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <History className="w-4 h-4" />
          <span className="hidden md:inline">History</span>
        </button>

        <button
          type="button"
          onClick={() => save()}
          disabled={saving}
          className="border border-gray-300 hover:border-gray-400 text-gray-400 text-sm px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save draft
        </button>

        {status === 'active' ? (
          <button
            type="button"
            onClick={pause}
            disabled={activating}
            className="bg-yellow-100 hover:bg-yellow-500/30 text-yellow-700 border border-yellow-200 text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={activate}
            disabled={activating}
            className="bg-blue-600 hover:bg-blue-500 text-gray-900 text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {status === 'paused' ? 'Resume' : 'Activate'}
          </button>
        )}
      </header>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas (left/center) */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
            {/* Trigger picker */}
            <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">Trigger</h2>
              </div>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as WorkflowTriggerType)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-blue-500 outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} — {o.description}
                  </option>
                ))}
              </select>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Workflow description (optional, for internal reference)"
                rows={2}
                className="mt-3 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-400 focus:border-blue-500 outline-none resize-none"
              />
            </section>

            <ChainEditor
              steps={steps}
              parentPath={[]}
              onAdd={addStep}
              onRemove={removeStep}
              onSelect={setSelectedPath}
              selectedPath={selectedPath}
              templates={templates}
            />
          </div>
        </main>

        {/* Right panel — config drawer / history */}
        <aside className="w-96 border-l border-gray-200 bg-gray-50 overflow-y-auto">
          {showHistory ? (
            <VersionHistoryPanel
              versions={versions}
              currentVersion={version}
              onClose={() => setShowHistory(false)}
              workflowId={workflowId}
              onRestored={async () => {
                setShowHistory(false);
                if (!workflowId) return;
                const res = await fetch(`/api/admin/crm/automations/${workflowId}`);
                const json = await res.json();
                if (json.workflow) {
                  const wf = json.workflow as Workflow;
                  setName(wf.name);
                  setDescription(wf.description ?? '');
                  setTriggerType(wf.trigger_type);
                  setSteps(graphToSteps(wf.nodes));
                  setStatus(wf.status);
                  setVersion(wf.version);
                  setVersions(json.versions ?? []);
                }
              }}
            />
          ) : selected ? (
            <NodeConfigPanel
              step={selected.step}
              templates={templates}
              onChange={(patch) => updateStep(selected.parentPath, selected.idx, patch)}
              onClose={() => setSelectedPath(null)}
              onDelete={() => removeStep(selected.parentPath, selected.idx)}
            />
          ) : (
            <div className="p-6 text-center">
              <Settings className="w-8 h-8 text-gray-400 mx-auto mb-3" />
              <p className="text-xs text-gray-500">
                Click a node to configure it, or add a new step using the + buttons in the canvas.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Chain renderer — recursive (condition branches contain sub-chains)
// ----------------------------------------------------------------------------

function ChainEditor({
  steps,
  parentPath,
  onAdd,
  onRemove,
  onSelect,
  selectedPath,
  templates,
  depth = 0,
}: {
  steps: Step[];
  parentPath: string[];
  onAdd: (parentPath: string[], type: WorkflowNodeType, insertAt: number) => void;
  onRemove: (parentPath: string[], idx: number) => void;
  onSelect: (path: string[] | null) => void;
  selectedPath: string[] | null;
  templates: TemplateOption[];
  depth?: number;
}) {
  return (
    <div className={cn('flex flex-col items-center', depth === 0 && 'mt-2')}>
      <AddStepButton onAdd={(type) => onAdd(parentPath, type, 0)} small />
      {steps.length === 0 && depth === 0 && (
        <p className="text-xs text-gray-500 mt-2 mb-2">No steps yet. Add the first action above.</p>
      )}
      {steps.map((step, idx) => {
        const path = [...parentPath, `${idx}`];
        const isSelected =
          selectedPath?.length === path.length &&
          selectedPath.every((p, i) => p === path[i]);
        const Icon = nodeIcon(step.node.type);
        return (
          <div key={step.uid} className="flex flex-col items-center w-full">
            <Connector />
            <button
              type="button"
              onClick={() => onSelect(path)}
              className={cn(
                'w-full max-w-md bg-white border rounded-xl p-3.5 text-left transition-all group',
                isSelected
                  ? 'border-blue-500 ring-1 ring-blue-500/40'
                  : 'border-gray-200 hover:border-gray-300',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                    step.node.type === 'condition' && 'bg-purple-50 text-purple-700',
                    step.node.type === 'delay' && 'bg-yellow-50 text-yellow-700',
                    step.node.type.startsWith('action.send') && 'bg-blue-50 text-blue-600',
                    step.node.type === 'action.createTask' && 'bg-emerald-50 text-emerald-700',
                    step.node.type === 'action.updateStage' && 'bg-orange-50 text-orange-700',
                    step.node.type === 'action.notifyAdmin' && 'bg-pink-500/15 text-pink-400',
                    step.node.type === 'action.endWorkflow' && 'bg-red-50 text-red-600',
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{nodeLabel(step.node.type)}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {summarizeNode(step.node, templates)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Remove this step?')) onRemove(parentPath, idx);
                  }}
                  className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </button>

            {step.node.type === 'condition' && step.branches && (
              <div className="w-full max-w-md mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <BranchColumn
                    label="If TRUE"
                    color="emerald"
                    steps={step.branches.true}
                    parentPath={[...path, '0:true']}
                    onAdd={onAdd}
                    onRemove={onRemove}
                    onSelect={onSelect}
                    selectedPath={selectedPath}
                    templates={templates}
                    depth={depth + 1}
                  />
                  <BranchColumn
                    label="If FALSE"
                    color="red"
                    steps={step.branches.false}
                    parentPath={[...path, '0:false']}
                    onAdd={onAdd}
                    onRemove={onRemove}
                    onSelect={onSelect}
                    selectedPath={selectedPath}
                    templates={templates}
                    depth={depth + 1}
                  />
                </div>
              </div>
            )}

            {step.node.type !== 'condition' && (
              <AddStepButton onAdd={(type) => onAdd(parentPath, type, idx + 1)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BranchColumn({
  label,
  color,
  steps,
  parentPath,
  onAdd,
  onRemove,
  onSelect,
  selectedPath,
  templates,
  depth,
}: {
  label: string;
  color: 'emerald' | 'red';
  steps: Step[];
  parentPath: string[];
  onAdd: (parentPath: string[], type: WorkflowNodeType, insertAt: number) => void;
  onRemove: (parentPath: string[], idx: number) => void;
  onSelect: (path: string[] | null) => void;
  selectedPath: string[] | null;
  templates: TemplateOption[];
  depth: number;
}) {
  return (
    <div
      className={cn(
        'border rounded-lg p-3 flex flex-col items-center',
        color === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-200 bg-red-500/5',
      )}
    >
      <div
        className={cn(
          'text-[10px] font-semibold uppercase tracking-wider mb-1',
          color === 'emerald' ? 'text-emerald-700' : 'text-red-600',
        )}
      >
        {label}
      </div>
      <ChainEditor
        steps={steps}
        parentPath={parentPath}
        onAdd={onAdd}
        onRemove={onRemove}
        onSelect={onSelect}
        selectedPath={selectedPath}
        templates={templates}
        depth={depth}
      />
    </div>
  );
}

function Connector() {
  return <div className="w-px h-5 bg-gray-700" />;
}

function AddStepButton({ onAdd, small }: { onAdd: (type: WorkflowNodeType) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cn(
          'mt-2 flex items-center gap-1.5 rounded-full border transition-colors',
          small
            ? 'border-gray-300 hover:border-blue-500 text-gray-500 hover:text-blue-600 text-[11px] px-2.5 py-1'
            : 'border-gray-300 hover:border-blue-500 text-gray-500 hover:text-blue-600 text-[11px] px-3 py-1 my-1',
        )}
      >
        <Plus className="w-3 h-3" />
        Add step
      </button>
      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-20 bg-white border border-gray-300 rounded-lg shadow-xl p-2 w-64 max-h-80 overflow-y-auto">
          {ADD_PALETTE.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.type}
                type="button"
                onClick={() => {
                  onAdd(p.type);
                  setOpen(false);
                }}
                className="w-full flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-gray-100 text-left"
              >
                <Icon className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-900">{p.label}</div>
                  <div className="text-[10px] text-gray-500">{p.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Right-side config drawer per node type
// ----------------------------------------------------------------------------

function NodeConfigPanel({
  step,
  templates,
  onChange,
  onClose,
  onDelete,
}: {
  step: Step;
  templates: TemplateOption[];
  onChange: (patch: Partial<WorkflowNode>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const cfg = step.node.config ?? {};
  const Icon = nodeIcon(step.node.type);

  function setConfig(patch: Record<string, unknown>) {
    onChange({ config: { ...cfg, ...patch } });
  }

  return (
    <div className="p-5 flex flex-col h-full">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">{nodeLabel(step.node.type)}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 text-xs">
        {step.node.type === 'action.sendEmail' && (
          <>
            <Field label="Template">
              <select
                value={(cfg.template_id as string) ?? ''}
                onChange={(e) => setConfig({ template_id: e.target.value || null, template_slug: undefined })}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              >
                <option value="">— Select a template —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {Boolean(cfg.template_slug) && !cfg.template_id && (
                <p className="text-[10px] text-yellow-700 mt-1">
                  Prebuilt placeholder: <code className="text-gray-400">{String(cfg.template_slug)}</code>.
                  Pick a real template before activating.
                </p>
              )}
            </Field>
            <Field label="Send type">
              <select
                value={(cfg.email_type as string) ?? 'transactional'}
                onChange={(e) => setConfig({ email_type: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              >
                <option value="transactional">Transactional</option>
                <option value="marketing">Marketing (requires opt-in)</option>
              </select>
            </Field>
          </>
        )}

        {step.node.type === 'action.sendSms' && (
          <Field
            label="SMS body"
            help='Supports {{firstName}}, {{depositUrl}}, etc. STOP reminder is appended automatically by Twilio.'
          >
            <textarea
              value={(cfg.body as string) ?? ''}
              onChange={(e) => setConfig({ body: e.target.value })}
              rows={5}
              className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none resize-none"
              placeholder="Hi {{firstName}}, your AutoLenis deposit is waiting…"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              {(cfg.body as string)?.length ?? 0} chars — keep under 320 for single concat
            </p>
          </Field>
        )}

        {step.node.type === 'delay' && (
          <Field label="Duration">
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {DELAY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setConfig({ duration: p.value })}
                  className={cn(
                    'text-[11px] px-2 py-1.5 rounded border transition-colors',
                    cfg.duration === p.value
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={(cfg.duration as string) ?? ''}
              onChange={(e) => setConfig({ duration: e.target.value })}
              placeholder="Custom: 10m, 4h, 2d…"
              className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
            />
          </Field>
        )}

        {step.node.type === 'condition' && (
          <>
            <Field label="Field">
              <select
                value={(cfg.field as string) ?? 'lifecycle_stage'}
                onChange={(e) => setConfig({ field: e.target.value, op: '', value: '' })}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Operator">
              <select
                value={(cfg.op as string) ?? ''}
                onChange={(e) => setConfig({ op: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              >
                <option value="">— Select —</option>
                {(CONDITION_FIELDS.find((f) => f.value === cfg.field)?.ops ?? []).map((op) => (
                  <option key={op} value={op}>{OP_LABELS[op]}</option>
                ))}
              </select>
            </Field>
            {!['is_true', 'is_false'].includes(cfg.op as string) && (
              <Field label="Value">
                {cfg.field === 'lifecycle_stage' ? (
                  <select
                    value={(cfg.value as string) ?? ''}
                    onChange={(e) => setConfig({ value: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
                  >
                    <option value="">— Select stage —</option>
                    {LIFECYCLE_STAGES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={(cfg.value as string) ?? ''}
                    onChange={(e) => setConfig({ value: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
                  />
                )}
              </Field>
            )}
          </>
        )}

        {step.node.type === 'action.createTask' && (
          <>
            <Field label="Task title">
              <input
                type="text"
                value={(cfg.title as string) ?? ''}
                onChange={(e) => setConfig({ title: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              />
            </Field>
            <Field label="Description (optional)">
              <textarea
                value={(cfg.description as string) ?? ''}
                onChange={(e) => setConfig({ description: e.target.value })}
                rows={3}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none resize-none"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Priority">
                <select
                  value={(cfg.priority as string) ?? 'medium'}
                  onChange={(e) => setConfig({ priority: e.target.value })}
                  className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
              <Field label="Due in (hours)">
                <input
                  type="number"
                  min={1}
                  value={(cfg.due_in_hours as number) ?? 24}
                  onChange={(e) => setConfig({ due_in_hours: Number(e.target.value) })}
                  className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
                />
              </Field>
            </div>
          </>
        )}

        {step.node.type === 'action.updateStage' && (
          <Field label="Set lifecycle stage to">
            <select
              value={(cfg.stage as string) ?? ''}
              onChange={(e) => setConfig({ stage: e.target.value })}
              className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
            >
              <option value="">— Select —</option>
              {LIFECYCLE_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}

        {step.node.type === 'action.notifyAdmin' && (
          <>
            <Field label="Subject">
              <input
                type="text"
                value={(cfg.subject as string) ?? ''}
                onChange={(e) => setConfig({ subject: e.target.value })}
                placeholder="[AutoLenis] Action required"
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              />
            </Field>
            <Field label="Message">
              <textarea
                value={(cfg.message as string) ?? ''}
                onChange={(e) => setConfig({ message: e.target.value })}
                rows={5}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none resize-none"
              />
            </Field>
            <Field label="Admin email (optional override)" help="Defaults to ADMIN_EMAIL env var.">
              <input
                type="email"
                value={(cfg.admin_email as string) ?? ''}
                onChange={(e) => setConfig({ admin_email: e.target.value })}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 outline-none"
              />
            </Field>
          </>
        )}

        {step.node.type === 'action.endWorkflow' && (
          <p className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg p-3">
            This node ends the workflow immediately. No subsequent steps will run.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          if (confirm('Remove this step?')) onDelete();
        }}
        className="mt-6 text-xs text-red-600/80 hover:text-red-700 flex items-center gap-1.5"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Remove this step
      </button>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {help && <p className="text-[10px] text-gray-500 mt-1">{help}</p>}
    </div>
  );
}

function VersionHistoryPanel({
  versions,
  currentVersion,
  onClose,
  workflowId,
  onRestored,
}: {
  versions: VersionMeta[];
  currentVersion: number;
  onClose: () => void;
  workflowId: string | null;
  onRestored: () => Promise<void>;
}) {
  const [restoring, setRestoring] = useState<string | null>(null);

  async function restore(versionId: string) {
    if (!workflowId) return;
    if (!confirm('Replace the current graph with this version? Your current work will be saved as v' + (currentVersion + 1) + ' first.')) return;
    setRestoring(versionId);
    try {
      const res = await fetch(`/api/admin/crm/automations/${workflowId}/versions/${versionId}/restore`, {
        method: 'POST',
      });
      if (!res.ok) {
        const json = await res.json();
        alert(json.error ?? 'Restore failed');
        return;
      }
      await onRestored();
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Version history</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {versions.length === 0 ? (
        <p className="text-xs text-gray-500">No saved versions yet. Save the workflow to create the first version.</p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2"
            >
              <div>
                <div className="text-xs font-medium text-gray-900">
                  v{v.version}
                  {v.version === currentVersion && (
                    <span className="ml-2 text-[10px] text-blue-600">current</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500">
                  {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
              {v.version !== currentVersion && (
                <button
                  type="button"
                  onClick={() => restore(v.id)}
                  disabled={!!restoring}
                  className="text-[11px] text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  {restoring === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Restore'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

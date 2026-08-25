import { logger } from "@/lib/logger";
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueEmail, enqueueSms } from '@/lib/services/comms/comms-outbox.service';
import type {
  Contact,
  TemplateVariable,
  Workflow,
  WorkflowConditionField,
  WorkflowConditionOp,
  WorkflowEdge,
  WorkflowEnrollment,
  WorkflowGraph,
  WorkflowNode,
  WorkflowTriggerType,
} from '@/lib/types/crm';

// Maximum nodes the engine will traverse in a single uninterrupted run before
// declaring a graph cycle. Reaches 'exit' on its own; this is purely a safety
// rail against operator-authored infinite loops (e.g. condition → condition →
// back to start).
const MAX_NODES_PER_RUN = 100;

// Cutover kill-switch for the legacy in-app workflow engine. After the Make.com
// cutover, Make owns all nurture dispatch; if this engine can still enroll or
// advance, it double-sends against the Make Processor (illegal duplicate sends).
// Default OFF — only the literal string 'true' enables it. This is the single
// source of truth for the engine's enabled state, enforced at BOTH public
// boundaries below (enrollContact + executeWorkflowFromNode) so that neither new
// enrollments NOR in-flight resumes (Inngest delay nodes) can dispatch while the
// flag is off. emit.ts performs the same check before invoking the engine to
// avoid the dynamic import cost when disabled.
export function isInAppEngineEnabled(): boolean {
  return process.env.CRM_INAPP_ENGINE_ENABLED === 'true';
}

// Duration parser: supports 10m / 1h / 24h / 3d / 7d / Xs (admin custom).
// Returns whole seconds. Throws on malformed input so misconfigured delay
// nodes surface immediately instead of being silently coerced to 0s.
export function parseDurationToSeconds(raw: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(raw.trim());
  if (!match) throw new Error(`DELAY_DURATION_INVALID:${raw}`);
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default:  throw new Error(`DELAY_DURATION_INVALID:${raw}`);
  }
}

function findNode(graph: WorkflowGraph, nodeId: string): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

function outgoingEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

// Substitute {{var}} tokens in a string against the supported template
// variable set. Mirrors TemplateService.substitute but standalone so the
// engine can prepare arbitrary message bodies (SMS) without going through
// the template renderer.
function substituteVars(
  source: string,
  vars: Partial<Record<TemplateVariable | string, string | number | null | undefined>>,
): string {
  return source.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (full, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function buildContactVars(contact: Contact): Record<string, string> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return {
    firstName: contact.first_name ?? '',
    lastName: contact.last_name ?? '',
    fullName: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    supportEmail: process.env.SUPPORT_EMAIL ?? '',
    dashboardUrl: `${base}/buyer/dashboard`,
    depositUrl: `${base}/buyer/deposit`,
    auctionUrl: `${base}/buyer/auction`,
    offerUrl: `${base}/buyer/offers`,
    unsubscribeUrl: `${base}/unsubscribe`,
  };
}

interface NodeResult {
  status: 'success' | 'failed' | 'skipped' | 'suspended';
  nextNodeId?: string;
  output?: Record<string, unknown>;
  error?: string;
}

// Evaluate a single condition rule against a contact row.
function evaluateCondition(
  contact: Contact,
  field: WorkflowConditionField,
  op: WorkflowConditionOp,
  value: unknown,
): boolean {
  // Tag operators read the array directly — the field column is implicit.
  if (op === 'has_tag' || op === 'not_has_tag') {
    const tags = contact.tags ?? [];
    const present = tags.includes(String(value));
    return op === 'has_tag' ? present : !present;
  }

  const actual = (contact as unknown as Record<string, unknown>)[field];

  switch (op) {
    case 'eq':           return actual === value;
    case 'neq':          return actual !== value;
    case 'is_true':      return actual === true;
    case 'is_false':     return actual === false;
    case 'contains':
      return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains':
      return !(typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase()));
    default:             return false;
  }
}

export class WorkflowEngine {
  // -------------------------------------------------------------------------
  // ENROLL — public entry: trigger fires → engine picks up here
  // -------------------------------------------------------------------------
  static async enrollContact(
    supabase: SupabaseClient,
    workflowId: string,
    contactId: string,
    triggerData: Record<string, unknown> = {},
  ): Promise<WorkflowEnrollment | null> {
    // Cutover gate: with the engine disabled, Make is the sole nurture sender.
    // Refuse to enroll so no contact can enter the in-app dispatch path.
    if (!isInAppEngineEnabled()) return null;
    const workflow = await this.loadWorkflow(supabase, workflowId);
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
    if (workflow.status !== 'active') {
      return null; // silently skip — only active workflows enroll
    }

    // Existing terminal enrollment? Clear it so re-enrollment is allowed.
    // The unique constraint on (workflow_id, contact_id) means we can have
    // at most one row per pair; the engine treats completed/exited rows as
    // historical and recycles them. Active rows block re-enrollment.
    const existing = await supabase
      .from('workflow_enrollments')
      .select('id, status')
      .eq('workflow_id', workflowId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (existing.data) {
      if (existing.data.status === 'active' || existing.data.status === 'paused') {
        return null; // dedup — already running
      }
      await supabase.from('workflow_enrollments').delete().eq('id', existing.data.id);
    }

    const entry = this.findEntryNode(workflow.nodes);
    if (!entry) throw new Error('WORKFLOW_NO_ENTRY_NODE');

    const firstAction = outgoingEdges(workflow.nodes, entry.id)[0]?.to ?? null;

    const { data: enrollment, error } = await supabase
      .from('workflow_enrollments')
      .insert({
        workflow_id: workflowId,
        contact_id: contactId,
        status: 'active',
        current_node_id: firstAction,
        trigger_data: triggerData,
      })
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('contact_timeline_events').insert({
      contact_id: contactId,
      event_type: 'automation_triggered',
      event_data: {
        workflow_id: workflowId,
        workflow_name: workflow.name,
        enrollment_id: enrollment.id,
      },
    });

    if (firstAction) {
      await this.executeWorkflowFromNode(supabase, enrollment.id, firstAction);
    } else {
      await this.completeEnrollment(supabase, enrollment.id);
    }

    return enrollment as WorkflowEnrollment;
  }

  // Public re-entry — called by the workflow-resume-drain cron when a delay
  // node's persisted resume_at falls due.
  static async resumeEnrollment(
    supabase: SupabaseClient,
    enrollmentId: string,
    nodeId: string,
  ): Promise<void> {
    return this.executeWorkflowFromNode(supabase, enrollmentId, nodeId);
  }

  // -------------------------------------------------------------------------
  // CORE LOOP — walk the graph until we hit suspend / terminal / end
  // -------------------------------------------------------------------------
  static async executeWorkflowFromNode(
    supabase: SupabaseClient,
    enrollmentId: string,
    startNodeId: string,
  ): Promise<void> {
    // Cutover gate: blocks advancement AND in-flight delay-node resumes, so a
    // pre-existing enrollment cannot dispatch once the engine is disabled.
    if (!isInAppEngineEnabled()) return;
    const enrollment = await this.loadEnrollment(supabase, enrollmentId);
    if (!enrollment) return;
    if (enrollment.status !== 'active') return;

    const workflow = await this.loadWorkflow(supabase, enrollment.workflow_id);
    if (!workflow || workflow.status !== 'active') {
      await this.exitEnrollment(supabase, enrollmentId, 'WORKFLOW_NOT_ACTIVE');
      return;
    }

    const contact = await this.loadContact(supabase, enrollment.contact_id);
    if (!contact || contact.deleted_at) {
      await this.exitEnrollment(supabase, enrollmentId, 'CONTACT_GONE');
      return;
    }

    let cursor: string | null = startNodeId;
    let steps = 0;

    while (cursor) {
      if (++steps > MAX_NODES_PER_RUN) {
        await this.exitEnrollment(supabase, enrollmentId, 'MAX_NODES_EXCEEDED');
        return;
      }

      const node = findNode(workflow.nodes, cursor);
      if (!node) {
        await this.exitEnrollment(supabase, enrollmentId, `NODE_MISSING:${cursor}`);
        return;
      }

      await supabase
        .from('workflow_enrollments')
        .update({ current_node_id: node.id })
        .eq('id', enrollmentId);

      let result: NodeResult;
      try {
        result = await this.executeNode(supabase, enrollment, contact, workflow, node);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.logExecution(supabase, enrollmentId, node, 'failed', {}, message);
        await this.failEnrollment(supabase, enrollmentId, message);
        return;
      }

      await this.logExecution(
        supabase,
        enrollmentId,
        node,
        result.status,
        result.output ?? {},
        result.error,
      );

      if (result.status === 'suspended') return; // delay node — resumed by workflow-resume-drain cron
      if (result.status === 'failed') {
        await this.failEnrollment(supabase, enrollmentId, result.error ?? 'NODE_FAILED');
        return;
      }
      if (!result.nextNodeId) {
        await this.completeEnrollment(supabase, enrollmentId);
        return;
      }

      cursor = result.nextNodeId;
    }
  }

  // -------------------------------------------------------------------------
  // EXECUTE NODE — dispatch table for every node type
  // -------------------------------------------------------------------------
  private static async executeNode(
    supabase: SupabaseClient,
    enrollment: WorkflowEnrollment,
    contact: Contact,
    workflow: Workflow,
    node: WorkflowNode,
  ): Promise<NodeResult> {
    const cfg = node.config ?? {};
    const next = outgoingEdges(workflow.nodes, node.id)[0]?.to;
    const contactVars = buildContactVars(contact);

    switch (node.type) {
      // -------- ACTIONS --------
      case 'action.sendEmail': {
        const templateId = cfg.template_id as string | undefined;
        if (!templateId) return { status: 'failed', error: 'TEMPLATE_ID_MISSING' };
        if (!contact.email) return { status: 'skipped', nextNodeId: next, output: { reason: 'NO_EMAIL' } };

        await enqueueEmail({
          contactId: contact.id,
          email: contact.email,
          templateId,
          templateVariables: contactVars,
          type: (cfg.email_type as 'transactional' | 'marketing') ?? 'transactional',
          idempotencyKey: `workflow:${enrollment.id}:${node.id}:email`,
        });
        return { status: 'success', nextNodeId: next, output: { template_id: templateId } };
      }

      case 'action.sendSms': {
        const bodyTemplate = (cfg.body as string | undefined)?.trim();
        if (!bodyTemplate) return { status: 'failed', error: 'SMS_BODY_MISSING' };
        if (!contact.phone) return { status: 'skipped', nextNodeId: next, output: { reason: 'NO_PHONE' } };
        if (!contact.consent_sms) return { status: 'skipped', nextNodeId: next, output: { reason: 'NO_CONSENT' } };

        const body = substituteVars(bodyTemplate, contactVars);
        await enqueueSms({
          contactId: contact.id,
          phone: contact.phone,
          body,
          idempotencyKey: `workflow:${enrollment.id}:${node.id}:sms`,
        });
        return { status: 'success', nextNodeId: next, output: { body_length: body.length } };
      }

      case 'action.createTask': {
        const title = ((cfg.title as string | undefined) ?? '').trim();
        if (!title) return { status: 'failed', error: 'TASK_TITLE_MISSING' };
        const priority = (cfg.priority as string) ?? 'medium';
        const dueInHours = Number(cfg.due_in_hours ?? 24);
        const dueAt = new Date(Date.now() + dueInHours * 3600 * 1000).toISOString();

        const { error } = await supabase.from('crm_tasks').insert({
          title: substituteVars(title, contactVars),
          description: cfg.description
            ? substituteVars(String(cfg.description), contactVars)
            : null,
          priority,
          status: 'open',
          scope: 'contact',
          contact_id: contact.id,
          assigned_to: (cfg.assigned_to as string) ?? null,
          due_at: dueAt,
          source: 'automation',
          workflow_enrollment_id: enrollment.id,
        });
        if (error) return { status: 'failed', error: error.message };

        await supabase.from('contact_timeline_events').insert({
          contact_id: contact.id,
          event_type: 'task_created',
          event_data: { source: 'automation', workflow_id: workflow.id },
        });
        return { status: 'success', nextNodeId: next };
      }

      case 'action.updateStage': {
        const newStage = cfg.stage as string | undefined;
        if (!newStage) return { status: 'failed', error: 'STAGE_MISSING' };
        if (newStage === contact.lifecycle_stage) {
          return { status: 'skipped', nextNodeId: next, output: { reason: 'STAGE_UNCHANGED' } };
        }

        const { error } = await supabase
          .from('contacts')
          .update({ lifecycle_stage: newStage, updated_at: new Date().toISOString() })
          .eq('id', contact.id);
        if (error) return { status: 'failed', error: error.message };

        await supabase.from('contact_timeline_events').insert({
          contact_id: contact.id,
          event_type: 'stage_changed',
          event_data: {
            from: contact.lifecycle_stage,
            to: newStage,
            source: 'automation',
            workflow_id: workflow.id,
          },
        });
        return { status: 'success', nextNodeId: next, output: { from: contact.lifecycle_stage, to: newStage } };
      }

      case 'action.assignAdmin': {
        const adminId = cfg.admin_id as string | undefined;
        if (!adminId) return { status: 'failed', error: 'ADMIN_ID_MISSING' };
        const { error } = await supabase
          .from('contacts')
          .update({ assigned_to: adminId, updated_at: new Date().toISOString() })
          .eq('id', contact.id);
        if (error) return { status: 'failed', error: error.message };
        return { status: 'success', nextNodeId: next };
      }

      case 'action.notifyAdmin': {
        const adminEmail = (cfg.admin_email as string | undefined) ?? process.env.ADMIN_EMAIL;
        if (!adminEmail) return { status: 'failed', error: 'ADMIN_EMAIL_MISSING' };

        const subject = substituteVars(
          (cfg.subject as string | undefined) ?? `[AutoLenis] ${workflow.name}`,
          contactVars,
        );
        const message = substituteVars(
          (cfg.message as string | undefined) ?? '',
          contactVars,
        );
        const html = `<p>${message.replace(/\n/g, '<br/>') || '(no message)'}</p>
          <p style="margin-top:24px;font-size:12px;color:#6b7280;">
            Contact: ${contact.first_name ?? ''} ${contact.last_name ?? ''}
            (${contact.email ?? 'no email'})<br/>
            Workflow: ${workflow.name}
          </p>`;

        await enqueueEmail({
          email: adminEmail,
          subject,
          html,
          text: message,
          type: 'transactional',
          idempotencyKey: `workflow:${enrollment.id}:${node.id}:notify`,
        });
        return { status: 'success', nextNodeId: next };
      }

      case 'action.endWorkflow':
        return { status: 'success' }; // no nextNodeId → loop completes

      // -------- CONDITION --------
      case 'condition': {
        const field = cfg.field as WorkflowConditionField | undefined;
        const op = cfg.op as WorkflowConditionOp | undefined;
        const value = cfg.value;
        if (!field || !op) return { status: 'failed', error: 'CONDITION_INCOMPLETE' };

        const passed = evaluateCondition(contact, field, op, value);
        const branchEdges = outgoingEdges(workflow.nodes, node.id);
        const target = branchEdges.find(
          (e) => e.branch === (passed ? 'true' : 'false'),
        )?.to;
        return {
          status: 'success',
          nextNodeId: target,
          output: { field, op, value: value as string | number | boolean | null, passed },
        };
      }

      // -------- DELAY (suspends until the workflow-resume-drain cron resumes) --------
      // Durable Postgres state (NOT Inngest, setTimeout, or a detached promise):
      // persist WHEN to resume (resume_at) and WHICH node to resume from
      // (resume_node_id) on the enrollment. The internal workflow-resume-drain
      // cron selects due rows and re-enters resumeEnrollment.
      case 'delay': {
        const duration = (cfg.duration as string | undefined) ?? '';
        const seconds = parseDurationToSeconds(duration);
        if (!next) {
          // Delay with no successor → effectively an end node. Don't schedule.
          return { status: 'success' };
        }
        const resumeAt = new Date(Date.now() + seconds * 1000).toISOString();
        const { error: persistErr } = await supabase
          .from('workflow_enrollments')
          .update({ resume_at: resumeAt, resume_node_id: next })
          .eq('id', enrollment.id);
        // A failed persist must FAIL the node — never report 'suspended' without
        // durable resume state, or the enrollment strands forever (the drain
        // would never select it). Mirrors the old inngest.send throw → failEnrollment.
        if (persistErr) {
          return { status: 'failed', error: `RESUME_PERSIST_FAILED: ${persistErr.message}` };
        }
        return { status: 'suspended', output: { duration, resume_at: resumeAt } };
      }

      // Trigger nodes should not be hit during execution — we start from the
      // node after the trigger. Treat as no-op skip.
      case 'trigger':
        return { status: 'skipped', nextNodeId: next, output: { reason: 'TRIGGER_BYPASS' } };

      default: {
        const exhaustive: never = node.type;
        return { status: 'failed', error: `UNKNOWN_NODE_TYPE:${String(exhaustive)}` };
      }
    }
  }

  // -------------------------------------------------------------------------
  // TRIGGER FAN-OUT — called by event source (webhook, cron, lifecycle hook)
  // Finds every active workflow listening for `triggerType` and enrolls the
  // contact into each. Safe to call from any server-side path; the engine
  // dedups concurrent enrollments via the unique constraint.
  // -------------------------------------------------------------------------
  static async triggerForEvent(
    supabase: SupabaseClient,
    triggerType: WorkflowTriggerType,
    contactId: string,
    triggerData: Record<string, unknown> = {},
  ): Promise<{ enrolled: number; skipped: number }> {
    const { data: workflows } = await supabase
      .from('workflows')
      .select('id, prebuilt_key')
      .eq('status', 'active')
      .eq('trigger_type', triggerType);

    // §10 truthfulness invariant: a concierge-converted deposit converges to an
    // already-CLOSED auction with offers ready — it never launches a live
    // competitive auction. So a `deposit_paid` carrying `concierge === true` must
    // NOT enroll into the live-auction-launch workflow, whose copy says "your
    // auction is live. Dealers are now competing." This is state-eligibility, not
    // wording: the concierge deposit is simply not eligible for that workflow.
    const isConciergeDeposit = triggerData?.concierge === true;

    let enrolled = 0;
    let skipped = 0;
    for (const w of workflows ?? []) {
      if (isConciergeDeposit && (w as { prebuilt_key?: string | null }).prebuilt_key === 'auction_launch') {
        skipped += 1;
        continue;
      }
      try {
        const e = await this.enrollContact(supabase, w.id, contactId, triggerData);
        if (e) enrolled += 1;
        else skipped += 1;
      } catch (err) {
        // Log but never let one workflow failure block the others. Failures
        // are visible in workflow_execution_log if the enrollment itself
        // succeeded; if it never enrolled the API call still returns success
        // for the others.
        logger.error('[workflow] enroll failed', w.id, err);
      }
    }
    return { enrolled, skipped };
  }

  // -------------------------------------------------------------------------
  // INTERNAL HELPERS
  // -------------------------------------------------------------------------
  private static findEntryNode(graph: WorkflowGraph): WorkflowNode | undefined {
    return graph.nodes.find((n) => n.type === 'trigger');
  }

  private static async loadWorkflow(
    supabase: SupabaseClient,
    id: string,
  ): Promise<Workflow | null> {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Workflow | null) ?? null;
  }

  private static async loadEnrollment(
    supabase: SupabaseClient,
    id: string,
  ): Promise<WorkflowEnrollment | null> {
    const { data, error } = await supabase
      .from('workflow_enrollments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as WorkflowEnrollment | null) ?? null;
  }

  private static async loadContact(
    supabase: SupabaseClient,
    id: string,
  ): Promise<Contact | null> {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Contact | null) ?? null;
  }

  private static async logExecution(
    supabase: SupabaseClient,
    enrollmentId: string,
    node: WorkflowNode,
    status: NodeResult['status'] | 'pending',
    output: Record<string, unknown>,
    errorMessage?: string,
  ): Promise<void> {
    await supabase.from('workflow_execution_log').insert({
      enrollment_id: enrollmentId,
      node_id: node.id,
      node_type: node.type,
      status,
      input_data: {},
      output_data: output,
      error_message: errorMessage ?? null,
    });
  }

  private static async completeEnrollment(
    supabase: SupabaseClient,
    enrollmentId: string,
  ): Promise<void> {
    const { data } = await supabase
      .from('workflow_enrollments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_node_id: null,
      })
      .eq('id', enrollmentId)
      .select('contact_id, workflow_id')
      .single();

    if (data) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: data.contact_id,
        event_type: 'automation_completed',
        event_data: { workflow_id: data.workflow_id, enrollment_id: enrollmentId },
      });
    }
  }

  private static async exitEnrollment(
    supabase: SupabaseClient,
    enrollmentId: string,
    reason: string,
  ): Promise<void> {
    const { data } = await supabase
      .from('workflow_enrollments')
      .update({
        status: 'exited',
        exited_at: new Date().toISOString(),
        exit_reason: reason,
      })
      .eq('id', enrollmentId)
      .select('contact_id, workflow_id')
      .single();

    if (data) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: data.contact_id,
        event_type: 'automation_exited',
        event_data: { workflow_id: data.workflow_id, enrollment_id: enrollmentId, reason },
      });
    }
  }

  private static async failEnrollment(
    supabase: SupabaseClient,
    enrollmentId: string,
    reason: string,
  ): Promise<void> {
    const { data } = await supabase
      .from('workflow_enrollments')
      .update({
        status: 'failed',
        exited_at: new Date().toISOString(),
        exit_reason: reason,
      })
      .eq('id', enrollmentId)
      .select('contact_id, workflow_id')
      .single();

    if (data) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: data.contact_id,
        event_type: 'automation_exited',
        event_data: { workflow_id: data.workflow_id, enrollment_id: enrollmentId, reason, failed: true },
      });
    }
  }
}

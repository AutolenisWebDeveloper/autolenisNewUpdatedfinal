import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import {
  generateContentDraft,
  generateAutomationPlan,
  CopilotValidationError,
  COPILOT_MODEL,
  type CopilotMode,
} from '@/lib/ai/crm-copilot';

export const dynamic = 'force-dynamic';

interface CopilotRequest {
  prompt?: string;
  mode?: CopilotMode;
  context?: string;
}

// POST /api/admin/crm/copilot
// Admin-only. Drafts marketing content or a Zod-validated automation plan from a
// prompt. Output is a DRAFT — it is NOT saved here and nothing is sent. Every
// generation is audit-logged (prompt + mode + model only — NOT the context,
// which may carry recipient PII).
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: CopilotRequest;
  try {
    body = (await req.json()) as CopilotRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const mode = body.mode;
  if (!prompt) {
    return NextResponse.json({ error: 'PROMPT_REQUIRED' }, { status: 400 });
  }
  if (mode !== 'content' && mode !== 'automation_plan') {
    return NextResponse.json({ error: 'INVALID_MODE' }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Audit the generation attempt: prompt + mode + model + flagCount. Deliberately
  // NOT the `context` field or the draft text, which may carry recipient PII —
  // flagCount is a bare count of detected unsubstantiated claims, no copy.
  const auditGenerate = (flagCount: number) =>
    writeCrmAuditLog(supabase, actor, {
      action: 'CRM_COPILOT_GENERATE',
      entity_type: 'crm_copilot',
      metadata: {
        mode,
        model: COPILOT_MODEL,
        prompt: prompt.slice(0, 2000),
        flagCount,
      },
    });

  try {
    if (mode === 'content') {
      const draft = await generateContentDraft(prompt, body.context);
      const flagCount =
        draft.emails.reduce((n, e) => n + e.flags.length, 0) +
        draft.sms.reduce((n, s) => n + s.flags.length, 0);
      await auditGenerate(flagCount);
      // `draft` already carries per-draft `flags`, serialized with the response.
      return NextResponse.json({ mode, draft });
    }
    const plan = await generateAutomationPlan(prompt, body.context);
    await auditGenerate(0);
    return NextResponse.json({ mode, plan });
  } catch (err) {
    // Still audit the failed attempt (no draft → no flags).
    await auditGenerate(0);
    // Validation failure (retry already exhausted inside the generator) → 422,
    // structured, and nothing was persisted.
    if (err instanceof CopilotValidationError) {
      return NextResponse.json(
        { error: 'COPILOT_VALIDATION_FAILED', issues: err.issues },
        { status: 422 },
      );
    }
    const message = err instanceof Error ? err.message : 'COPILOT_FAILED';
    return NextResponse.json({ error: 'COPILOT_FAILED', detail: message }, { status: 502 });
  }
}

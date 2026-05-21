import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EmailTemplate,
  EmailTemplateInput,
  EmailTemplateStatus,
  EmailTemplateUpdate,
  EmailTemplateVersion,
  RenderedTemplate,
  TemplateVariable,
} from '../types/crm';

// The 12 platform-supported variables. Anything outside this set is left as
// a literal {{...}} in the rendered output so missing data is visible during
// QA instead of silently swallowed.
const SUPPORTED_VARIABLES: readonly TemplateVariable[] = [
  'firstName', 'lastName', 'fullName',
  'vehicleMake', 'vehicleModel', 'vehicleYear',
  'dashboardUrl', 'depositUrl', 'auctionUrl', 'offerUrl',
  'supportEmail', 'unsubscribeUrl',
] as const;

// CAN-SPAM physical mailing address — must appear in every marketing email.
// Update via env so legal can change the registered address without a deploy.
const PHYSICAL_ADDRESS =
  process.env.AUTOLENIS_PHYSICAL_ADDRESS ??
  '1234 Main St, Suite 100, San Francisco CA 94105';
const BRAND_NAME = 'AutoLenis';
const UNSUB_MARKER = '{{unsubscribeUrl}}';

// Footer is appended on render rather than baked into each template so changing
// the physical address or legal copy is a single-line update — and so existing
// templates that already have a footer aren't double-stamped.
const FOOTER_SIGNATURE = '<!-- autolenis:footer:v1 -->';

function hasFooter(html: string): boolean {
  return html.includes(FOOTER_SIGNATURE);
}

function buildFooterHtml(unsubscribeUrl: string): string {
  return [
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;" ${FOOTER_SIGNATURE}>`,
    `  <div><strong>${BRAND_NAME}</strong> · ${PHYSICAL_ADDRESS}</div>`,
    `  <div style="margin-top:4px;">`,
    `    <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>`,
    `  </div>`,
    `</div>`,
  ].join('\n');
}

function buildFooterText(unsubscribeUrl: string): string {
  return [
    '',
    '—',
    `${BRAND_NAME} · ${PHYSICAL_ADDRESS}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');
}

// Replace {{token}} occurrences with the variable's value. Tokens we don't
// recognize are intentionally left intact so they show up during QA.
function substitute(
  source: string,
  variables: Partial<Record<TemplateVariable | string, string | number | null | undefined>>,
): string {
  return source.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (full, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) {
      // Unknown variable → leave it; known-but-missing variable → empty string.
      return (SUPPORTED_VARIABLES as readonly string[]).includes(name) ? '' : full;
    }
    return String(value);
  });
}

// Trivial HTML → plain text fallback. Only used when the template has no
// dedicated text_body. Strips tags, collapses whitespace, decodes the entities
// that show up in our generated copy.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class TemplateService {
  static readonly SUPPORTED_VARIABLES = SUPPORTED_VARIABLES;

  static async getTemplate(
    supabase: SupabaseClient,
    id: string,
  ): Promise<EmailTemplate | null> {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as EmailTemplate | null) ?? null;
  }

  static async listTemplates(
    supabase: SupabaseClient,
    options: { status?: EmailTemplateStatus; category?: string; search?: string } = {},
  ): Promise<EmailTemplate[]> {
    let query = supabase
      .from('email_templates')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200);

    if (options.status) query = query.eq('status', options.status);
    if (options.category) query = query.eq('category', options.category);
    if (options.search) {
      const q = options.search.replace(/[%_]/g, '\\$&');
      query = query.or(`name.ilike.%${q}%,subject.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as EmailTemplate[]) ?? [];
  }

  static async listVersions(
    supabase: SupabaseClient,
    templateId: string,
    limit = 10,
  ): Promise<EmailTemplateVersion[]> {
    const { data, error } = await supabase
      .from('email_template_versions')
      .select('*')
      .eq('template_id', templateId)
      .order('version', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as EmailTemplateVersion[]) ?? [];
  }

  static async createTemplate(
    supabase: SupabaseClient,
    input: EmailTemplateInput,
    adminId: string | null,
  ): Promise<EmailTemplate> {
    const variables = input.variables ?? this.extractVariables(input.subject, input.html_body);

    const { data, error } = await supabase
      .from('email_templates')
      .insert({
        name: input.name,
        subject: input.subject,
        category: input.category ?? 'transactional',
        html_body: input.html_body,
        text_body: input.text_body ?? null,
        variables,
        status: input.status ?? 'draft',
        version: 1,
        created_by: adminId,
        updated_by: adminId,
      })
      .select('*')
      .single();

    if (error) throw error;

    // Seed version history with v1.
    await supabase.from('email_template_versions').insert({
      template_id: data.id,
      version: 1,
      subject: data.subject,
      html_body: data.html_body,
      text_body: data.text_body,
      created_by: adminId,
    });

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'CREATE_EMAIL_TEMPLATE',
        entity_type: 'email_template',
        entity_id: data.id,
        after_state: data,
      });
    }

    return data as EmailTemplate;
  }

  // Save the current row to email_template_versions BEFORE applying updates,
  // then bump version on the live row. This guarantees the version table is
  // always a complete history including the pre-edit state.
  static async updateTemplate(
    supabase: SupabaseClient,
    id: string,
    updates: EmailTemplateUpdate,
    adminId: string | null,
  ): Promise<EmailTemplate> {
    const before = await this.getTemplate(supabase, id);
    if (!before) throw new Error('TEMPLATE_NOT_FOUND');

    const bodyChanged =
      (updates.subject !== undefined && updates.subject !== before.subject) ||
      (updates.html_body !== undefined && updates.html_body !== before.html_body) ||
      (updates.text_body !== undefined && updates.text_body !== before.text_body);

    if (bodyChanged) {
      await supabase.from('email_template_versions').insert({
        template_id: id,
        version: before.version,
        subject: before.subject,
        html_body: before.html_body,
        text_body: before.text_body,
        created_by: before.updated_by,
      });
    }

    const patch: Record<string, unknown> = {
      updated_by: adminId,
    };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.html_body !== undefined) patch.html_body = updates.html_body;
    if (updates.text_body !== undefined) patch.text_body = updates.text_body;
    if (updates.status !== undefined) patch.status = updates.status;
    if (bodyChanged) {
      patch.version = before.version + 1;
      patch.variables =
        updates.variables ??
        this.extractVariables(
          updates.subject ?? before.subject,
          updates.html_body ?? before.html_body,
        );
    } else if (updates.variables !== undefined) {
      patch.variables = updates.variables;
    }

    const { data, error } = await supabase
      .from('email_templates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'UPDATE_EMAIL_TEMPLATE',
        entity_type: 'email_template',
        entity_id: id,
        before_state: before,
        after_state: data,
      });
    }

    return data as EmailTemplate;
  }

  // Render a template for a specific recipient context. Always idempotent —
  // pure function of inputs, suitable for queue retries.
  static async renderTemplate(
    supabase: SupabaseClient,
    templateId: string,
    variables: Partial<Record<TemplateVariable | string, string | number | null | undefined>>,
  ): Promise<RenderedTemplate> {
    const template = await this.getTemplate(supabase, templateId);
    if (!template) throw new Error('TEMPLATE_NOT_FOUND');
    if (template.status !== 'active') throw new Error('TEMPLATE_NOT_ACTIVE');
    return this.renderInline(template, variables);
  }

  // Same as renderTemplate but skips the DB fetch — used by automations that
  // already loaded the template, and by the live preview UI.
  static renderInline(
    template: Pick<EmailTemplate, 'subject' | 'html_body' | 'text_body'>,
    variables: Partial<Record<TemplateVariable | string, string | number | null | undefined>>,
  ): RenderedTemplate {
    const unsubscribeUrl =
      (variables.unsubscribeUrl as string | undefined) ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/unsubscribe`;

    const subject = substitute(template.subject, variables);

    let html = substitute(template.html_body, variables);
    if (!hasFooter(html)) {
      html = `${html}\n${buildFooterHtml(unsubscribeUrl)}`;
    }

    const rawText = template.text_body
      ? substitute(template.text_body, variables)
      : htmlToText(html);
    const text = rawText.includes(`Unsubscribe: ${unsubscribeUrl}`)
      ? rawText
      : `${rawText}${buildFooterText(unsubscribeUrl)}`;

    return { subject, html, text };
  }

  // Scan source strings for {{token}} occurrences and return the unique set of
  // supported variables referenced. Used to keep email_templates.variables in
  // sync with the actual body on save without making the author maintain it.
  static extractVariables(subject: string, html: string): string[] {
    const found = new Set<string>();
    const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
    for (const source of [subject, html]) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        if ((SUPPORTED_VARIABLES as readonly string[]).includes(match[1])) {
          found.add(match[1]);
        }
      }
    }
    return [...found];
  }

  // Validate that all {{tokens}} in the template reference supported variables.
  // Returns the list of unknown tokens so the UI can flag them; never throws.
  static findUnknownVariables(subject: string, html: string, text?: string | null): string[] {
    const unknown = new Set<string>();
    const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
    for (const source of [subject, html, text ?? '']) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        if (!(SUPPORTED_VARIABLES as readonly string[]).includes(match[1])) {
          unknown.add(match[1]);
        }
      }
    }
    return [...unknown];
  }

  static missingUnsubscribe(category: string, html: string, text?: string | null): boolean {
    if (category !== 'marketing') return false;
    return !html.includes(UNSUB_MARKER) && !(text ?? '').includes(UNSUB_MARKER);
  }
}

import { NextResponse } from 'next/server';
import { TemplateService } from '@/lib/services/template.service';
import { getAdminActor } from '@/lib/auth/admin-actor';
import type { TemplateVariable } from '@/lib/types/crm';

export const dynamic = 'force-dynamic';

type PreviewBody = {
  subject: string;
  html_body: string;
  text_body?: string | null;
  category?: string;
  variables?: Partial<Record<TemplateVariable | string, string>>;
};

// Sample values used when the caller doesn't supply overrides. Keeps the
// preview meaningful without forcing the UI to ship a fixture itself.
const SAMPLE: Record<TemplateVariable, string> = {
  firstName: 'Jordan',
  lastName: 'Lee',
  fullName: 'Jordan Lee',
  vehicleMake: 'Toyota',
  vehicleModel: 'RAV4',
  vehicleYear: '2024',
  dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/buyer/dashboard`,
  depositUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/buyer/deposit`,
  auctionUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/buyer/auction`,
  offerUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/buyer/offers`,
  resumeUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/lp/default?resume=1`,
  returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/lp/default?resume=1`,
  supportEmail: process.env.SUPPORT_EMAIL ?? 'support@autolenis.com',
  unsubscribeUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/unsubscribe?token=sample`,
};

// Read-only preview render — no audit log entry.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body?.subject || !body?.html_body) {
    return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 });
  }

  const variables = { ...SAMPLE, ...(body.variables ?? {}) };
  const rendered = TemplateService.renderInline(
    { subject: body.subject, html_body: body.html_body, text_body: body.text_body ?? null },
    variables,
  );

  const unknown = TemplateService.findUnknownVariables(
    body.subject,
    body.html_body,
    body.text_body,
  );
  const missingUnsubscribe = TemplateService.missingUnsubscribe(
    body.category ?? 'transactional',
    body.html_body,
    body.text_body,
  );

  return NextResponse.json({
    rendered,
    warnings: {
      unknown_variables: unknown,
      missing_unsubscribe: missingUnsubscribe,
    },
  });
}

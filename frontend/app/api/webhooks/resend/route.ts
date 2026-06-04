import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SuppressionService } from '@/lib/services/suppression.service';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Svix signature spec:
//   header value:   "v1,<base64-hmac> v1,<base64-hmac> ..."
//   signing string: `${svix-id}.${svix-timestamp}.${rawBody}`
//   secret format:  "whsec_<base64-secret>"  — strip prefix, decode base64
//   compare:        raw HMAC bytes (digest()) vs base64-decoded signature bytes
function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  let secretBytes: Buffer;
  try {
    const stripped = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
    secretBytes = Buffer.from(stripped, 'base64');
  } catch {
    return false;
  }

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(toSign).digest();

  for (const part of svixSignature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (sigBytes.length !== expected.length) continue;
    if (crypto.timingSafeEqual(sigBytes, expected)) return true;
  }

  return false;
}

// Phase 4B-3 — apply a Resend delivery event to the matching dealer outreach
// log row (matched by Resend message id). Best-effort: never throws into the
// webhook handler, since a missing row simply means the event wasn't ours.
async function updateDealerOutreachLog(
  type: string,
  resendId: string | undefined
): Promise<void> {
  if (!resendId) return;

  try {
    const log = await prisma.dealerOutreachLog.findFirst({
      where: { resendId },
      select: { id: true, status: true, metadata: true },
    });
    if (!log) return;

    switch (type) {
      case 'email.delivered':
        await prisma.dealerOutreachLog.update({
          where: { id: log.id },
          data: { status: 'delivered', deliveredAt: new Date() },
        });
        break;
      case 'email.bounced':
        await prisma.dealerOutreachLog.update({
          where: { id: log.id },
          data: { status: 'bounced' },
        });
        break;
      case 'email.complained':
        await prisma.dealerOutreachLog.update({
          where: { id: log.id },
          data: { status: 'complained' },
        });
        break;
      case 'email.opened': {
        const meta = (log.metadata && typeof log.metadata === 'object' ? log.metadata : {}) as Record<string, unknown>;
        const opens = typeof meta.opens === 'number' ? meta.opens : 0;
        await prisma.dealerOutreachLog.update({
          where: { id: log.id },
          data: { metadata: { ...meta, opens: opens + 1 } },
        });
        break;
      }
      case 'email.clicked': {
        const meta = (log.metadata && typeof log.metadata === 'object' ? log.metadata : {}) as Record<string, unknown>;
        const clicks = typeof meta.clicks === 'number' ? meta.clicks : 0;
        await prisma.dealerOutreachLog.update({
          where: { id: log.id },
          data: { metadata: { ...meta, clicks: clicks + 1 } },
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[resend.webhook] dealer outreach log update failed', err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();

    const svixId = req.headers.get('svix-id');
    const svixTimestamp = req.headers.get('svix-timestamp');
    const svixSignature = req.headers.get('svix-signature');
    const secret = process.env.RESEND_WEBHOOK_SECRET;

    if (!svixId || !svixTimestamp || !svixSignature || !secret) {
      return new NextResponse('Missing signature headers', { status: 401 });
    }

    if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, secret)) {
      return new NextResponse('Invalid signature', { status: 403 });
    }

    const payload = JSON.parse(rawBody) as {
      type: string;
      data: { to?: string[]; email?: string; email_id?: string } & Record<string, unknown>;
    };

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Phase 4B-3 — reflect delivery lifecycle on dealer_outreach_log rows.
    // Best-effort and isolated: never let a logging failure break suppression.
    await updateDealerOutreachLog(supabase, payload.type, payload.data.email_id).catch(
      (err) => console.error('[resend.webhook] dealer-outreach-log update failed', err)
    );

    const recipient =
      (Array.isArray(payload.data.to) ? payload.data.to[0] : undefined) ?? payload.data.email;

    switch (payload.type) {
      case 'email.bounced':
        if (recipient) await SuppressionService.suppressEmail(supabase, recipient, 'bounced', payload.data);
        break;
      case 'email.complained':
        if (recipient) await SuppressionService.suppressEmail(supabase, recipient, 'complained', payload.data);
        break;
      case 'email.unsubscribed':
        if (recipient) await SuppressionService.suppressEmail(supabase, recipient, 'unsubscribed', payload.data);
        break;
      default:
        // Other event types (delivered, opened, clicked) are reconciled against
        // the dealer outreach log below.
        break;
    }

    // Phase 4B-3 — reconcile Resend delivery events against dealer_outreach_log.
    // Keyed on the Resend message id (data.email_id). No-ops when the event is
    // unrelated to a dealer outreach send.
    await updateDealerOutreachLog(payload.type, payload.data.email_id);

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[resend.webhook] fatal', err);
    return new NextResponse('Internal Webhook Failure', { status: 500 });
  }
}

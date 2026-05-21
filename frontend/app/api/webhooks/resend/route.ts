import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { SuppressionService } from '@/lib/services/suppression.service';

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
      data: { to?: string[]; email?: string } & Record<string, unknown>;
    };

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const recipient =
      (Array.isArray(payload.data.to) ? payload.data.to[0] : undefined) ?? payload.data.email;
    if (!recipient) {
      return NextResponse.json({ ok: true, skipped: 'no_recipient' });
    }

    switch (payload.type) {
      case 'email.bounced':
        await SuppressionService.suppressEmail(supabase, recipient, 'bounced', payload.data);
        break;
      case 'email.complained':
        await SuppressionService.suppressEmail(supabase, recipient, 'complained', payload.data);
        break;
      case 'email.unsubscribed':
        await SuppressionService.suppressEmail(supabase, recipient, 'unsubscribed', payload.data);
        break;
      default:
        // Other event types (delivered, opened, clicked) are not handled in Phase 1.
        break;
    }

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[resend.webhook] fatal', err);
    return new NextResponse('Internal Webhook Failure', { status: 500 });
  }
}

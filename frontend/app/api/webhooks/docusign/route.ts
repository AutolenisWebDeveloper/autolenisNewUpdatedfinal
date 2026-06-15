// DocuSign webhook handler.
// Routes envelope-completed events to either the dealer marketplace
// agreement handler or the deal envelope handler.
//
// Signature validation: DocuSign Connect signs the raw request body with
// HMAC-SHA256 using the configured Connect key, then base64-encodes the
// digest into the `x-docusign-signature-1` header. We must verify the
// signature against the *raw* body before parsing.
//
// Idempotency: DocuSign retries failed deliveries up to ~12 times. We dedupe
// on `(envelopeId, event)` so the same envelope-completed event cannot drive
// the post-signing side effects (stage advance, contract record, email) more
// than once.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { handleEnvelopeCompleted } from "@/lib/services/esign/esign.service";
import { handleDealerMarketplaceEnvelopeCompleted } from "@/lib/services/esign/dealer-marketplace-agreement.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyDocuSignSignature(rawBody: string, headerSig: string | null, secret: string): boolean {
  if (!headerSig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(headerSig, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const webhookSecret = process.env.DOCUSIGN_WEBHOOK_SECRET;

  // Fail-closed: a missing secret in any environment must reject the request.
  // In production this prevents an unconfigured webhook from accepting forged
  // envelope-completed events. In dev/staging it surfaces the misconfiguration
  // immediately instead of silently accepting unsigned payloads.
  if (!webhookSecret) {
    logger.error("[docusign/webhook] DOCUSIGN_WEBHOOK_SECRET is not configured — rejecting request");
    return new NextResponse("Webhook not configured", { status: 503 });
  }

  const headerSig = request.headers.get("x-docusign-signature-1");
  if (!verifyDocuSignSignature(rawBody, headerSig, webhookSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: { event?: string; data?: { envelopeId?: string } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const event = body?.event;
  const envelopeId = body?.data?.envelopeId;

  if (event !== "envelope-completed" || !envelopeId) {
    // Acknowledge other event types without side effects so DocuSign stops retrying.
    return NextResponse.json({ received: true });
  }

  // Idempotency: skip processing if we have already finalized this envelope.
  // We piggyback on the existing PaymentProviderEvent table — namespaced
  // eventId can never collide with a Stripe event ID. An existing row with
  // processed=true means the side effects already ran; processed=false means
  // a prior delivery crashed mid-handler and we should retry.
  const dedupeKey = `docusign:${envelopeId}:${event}`;
  const existing = await prisma.paymentProviderEvent.findUnique({
    where: { eventId: dedupeKey },
    select: { processed: true },
  });
  if (existing?.processed) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (!existing) {
    try {
      await prisma.paymentProviderEvent.create({
        data: {
          eventId: dedupeKey,
          eventType: `docusign.${event}`,
          payload: JSON.parse(JSON.stringify(body)),
          processed: false,
        },
      });
    } catch (err) {
      // Concurrent delivery won the create race; treat as in-flight and 500
      // so DocuSign retries after the other handler finishes.
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002") {
        return new NextResponse("Concurrent delivery in progress", { status: 503 });
      }
      throw err;
    }
  }

  try {
    const handledByDealer = await handleDealerMarketplaceEnvelopeCompleted(envelopeId);
    if (!handledByDealer) {
      await handleEnvelopeCompleted(envelopeId);
    }

    await prisma.paymentProviderEvent.update({
      where: { eventId: dedupeKey },
      data: { processed: true, processedAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("[docusign/webhook] processing error:", err);
    // Leave the dedupe row in place with processed=false so an operator can
    // see the failure; return 500 so DocuSign retries the delivery.
    return new NextResponse("Processing error", { status: 500 });
  }
}

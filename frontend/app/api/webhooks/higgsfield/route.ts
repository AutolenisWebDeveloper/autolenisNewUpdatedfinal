// POST /api/webhooks/higgsfield
// Receives Higgsfield media-completion callbacks using the confirmed production
// response field names. Verifies an HMAC-SHA256 signature over the raw body
// (HIGGSFIELD_WEBHOOK_SECRET), reconciles the matching AiMediaGeneration and
// SocialVideo records, and — on success — promotes the parent post to SCHEDULED
// when auto-publish is enabled.
//
// /api/webhooks/* is already treated as public + CSRF-exempt by proxy.ts; this
// route does its own signature validation (same HMAC pattern as Stripe).

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ENABLE_AUTO_PUBLISH } from "@/lib/social/config";
import { claimProviderEvent } from "@/lib/services/webhooks/provider-event-dedup";
import type { HiggsfieldResponse } from "@/lib/social/providers/higgsfield.types";

const MAX_VIDEO_RETRIES = 3;

// Constant-time HMAC comparison. Returns true when no secret is configured only
// in non-production so local testing without a secret still works.
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-higgsfield-signature") ?? request.headers.get("x-webhook-signature");

  if (!verifySignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: HiggsfieldResponse;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const requestId = body.request_id;
  if (!requestId) return new NextResponse("Missing request_id", { status: 400 });

  const tracking = await prisma.aiMediaGeneration.findUnique({
    where: { higgsfieldRequestId: requestId },
  });
  const video = await prisma.socialVideo.findFirst({ where: { providerJobId: requestId } });

  if (!tracking && !video) {
    // Unknown job — ack so the provider stops retrying.
    return NextResponse.json({ received: true, matched: false });
  }

  const status = body.status;

  // Replay dedup for the state-changing statuses. Higgsfield retries deliveries,
  // and the `failed` branch increments retryCount unconditionally — a duplicate
  // `failed` callback would double-count it and prematurely exhaust MAX_VIDEO_RETRIES.
  // Key on (request_id, status) so a legitimate queued→completed transition is a
  // distinct event but a redelivery of the same status is suppressed. Non-terminal
  // statuses (queued/in_progress) change no state and are not claimed.
  let settle: (() => Promise<void>) | null = null;
  if (status === "completed" || status === "nsfw" || status === "failed") {
    const claim = await claimProviderEvent({
      provider: "higgsfield",
      eventId: `${requestId}:${status}`,
      eventType: status,
      payload: body,
    });
    if (claim.status === "duplicate") return NextResponse.json({ received: true, duplicate: true });
    if (claim.status === "in_progress") return new NextResponse("Concurrent delivery in progress", { status: 503 });
    settle = claim.settle;
  }

  // ── completed ──────────────────────────────────────────────────────────
  if (status === "completed") {
    const videoUrl = body.video?.url;
    const thumbnailUrl = body.images?.[0]?.url;

    if (tracking) {
      await prisma.aiMediaGeneration.update({
        where: { id: tracking.id },
        data: {
          status: "completed",
          outputVideoUrl: videoUrl,
          outputImages: body.images ?? undefined,
          outputRaw: body as unknown as object,
          completedAt: new Date(),
        },
      });
    }

    if (video) {
      await prisma.socialVideo.update({
        where: { id: video.id },
        data: {
          status: "VIDEO_READY",
          videoUrl,
          thumbnailUrl,
          generatedAt: new Date(),
          lastPolledAt: new Date(),
          errorMessage: null,
        },
      });
      if (ENABLE_AUTO_PUBLISH) {
        await prisma.socialPost.updateMany({
          where: { id: video.postId, status: "APPROVED" },
          data: { status: "SCHEDULED" },
        });
      }
      logger.info(`[higgsfield-webhook] video ${video.id} ready (request_id ${requestId})`);
    }
    if (settle) await settle();
    return NextResponse.json({ received: true, status: "ready" });
  }

  // ── nsfw ───────────────────────────────────────────────────────────────
  if (status === "nsfw") {
    if (tracking) {
      await prisma.aiMediaGeneration.update({
        where: { id: tracking.id },
        data: {
          status: "failed",
          nsfwFlagged: true,
          errorMessage: "NSFW content flagged",
          outputRaw: body as unknown as object,
        },
      });
    }
    if (video) {
      await prisma.socialVideo.update({
        where: { id: video.id },
        data: {
          status: "VIDEO_FAILED",
          errorMessage: "NSFW content flagged",
          lastPolledAt: new Date(),
        },
      });
    }
    logger.info(`[higgsfield-webhook] NSFW flagged: ${requestId}`);
    if (settle) await settle();
    return NextResponse.json({ received: true, status: "nsfw" });
  }

  // ── failed ───────────────────────────────────────────────────────────────
  if (status === "failed") {
    const errorMessage = "Higgsfield reported failure";
    if (tracking) {
      await prisma.aiMediaGeneration.update({
        where: { id: tracking.id },
        data: {
          status: "failed",
          errorMessage,
          outputRaw: body as unknown as object,
        },
      });
    }
    let retryable = false;
    if (video) {
      retryable = video.retryCount + 1 < MAX_VIDEO_RETRIES;
      await prisma.socialVideo.update({
        where: { id: video.id },
        data: {
          status: retryable ? "VIDEO_QUEUED" : "VIDEO_FAILED",
          errorMessage,
          retryCount: { increment: 1 },
          lastPolledAt: new Date(),
        },
      });
      logger.info(
        `[higgsfield-webhook] video ${video.id} failed (request_id ${requestId}), retryable=${retryable}`,
      );
    }
    if (settle) await settle();
    return NextResponse.json({ received: true, status: retryable ? "requeued" : "failed" });
  }

  // ── queued / in_progress / unknown — ack without state change. ───────────
  return NextResponse.json({ received: true, status: "ignored" });
}

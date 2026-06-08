// POST /api/webhooks/higgsfield
// Receives Higgsfield video-completion callbacks. Verifies an HMAC-SHA256
// signature over the raw body (HIGGSFIELD_WEBHOOK_SECRET), then transitions the
// matching SocialVideo to VIDEO_READY / VIDEO_FAILED and, on success, promotes
// the parent post to SCHEDULED when auto-publish is enabled.
//
// /api/webhooks/* is already treated as public + CSRF-exempt by proxy.ts; this
// route does its own signature validation.
//
// TODO: verify the exact signature header name + event field names against
// Higgsfield's webhook docs.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ENABLE_AUTO_PUBLISH } from "@/lib/social/config";

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

  let event: {
    event?: string;
    type?: string;
    status?: string;
    job_id?: string;
    jobId?: string;
    id?: string;
    video_url?: string;
    videoUrl?: string;
    thumbnail_url?: string;
    thumbnailUrl?: string;
    error?: string;
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const providerJobId = event.job_id ?? event.jobId ?? event.id;
  if (!providerJobId) return new NextResponse("Missing job id", { status: 400 });

  const video = await prisma.socialVideo.findFirst({ where: { providerJobId } });
  if (!video) {
    // Unknown job — ack so the provider stops retrying.
    return NextResponse.json({ received: true, matched: false });
  }

  const kind = (event.event ?? event.type ?? event.status ?? "").toLowerCase();
  const isFailure = ["failed", "error", "video.failed", "generation.failed"].some((k) => kind.includes(k));
  const isSuccess =
    !isFailure &&
    (["completed", "ready", "succeeded", "video.completed", "generation.completed"].some((k) => kind.includes(k)) ||
      Boolean(event.video_url ?? event.videoUrl));

  if (isSuccess) {
    await prisma.socialVideo.update({
      where: { id: video.id },
      data: {
        status: "VIDEO_READY",
        videoUrl: event.video_url ?? event.videoUrl,
        thumbnailUrl: event.thumbnail_url ?? event.thumbnailUrl,
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
    console.log(`[higgsfield-webhook] video ${video.id} ready (job ${providerJobId})`);
    return NextResponse.json({ received: true, status: "ready" });
  }

  if (isFailure) {
    const retryable = video.retryCount + 1 < MAX_VIDEO_RETRIES;
    await prisma.socialVideo.update({
      where: { id: video.id },
      data: {
        status: retryable ? "VIDEO_QUEUED" : "VIDEO_FAILED",
        errorMessage: event.error ?? "Higgsfield reported failure",
        retryCount: { increment: 1 },
        lastPolledAt: new Date(),
      },
    });
    console.log(`[higgsfield-webhook] video ${video.id} failed (job ${providerJobId}), retryable=${retryable}`);
    return NextResponse.json({ received: true, status: retryable ? "requeued" : "failed" });
  }

  // Intermediate / unknown event — ack without state change.
  return NextResponse.json({ received: true, status: "ignored" });
}

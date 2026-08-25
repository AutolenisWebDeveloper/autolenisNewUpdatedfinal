// MicroBilt webhook handler for IBV callbacks
//
// MicroBilt's Connect-style callback delivers a shared secret in the
// `x-microbilt-secret` header. We fail closed if the secret is unset so an
// unconfigured webhook cannot accept forged status updates.
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { claimProviderEvent } from "@/lib/services/webhooks/provider-event-dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function POST(request: NextRequest) {
  const expected = process.env.MICROBILT_WEBHOOK_SECRET;
  if (!expected) {
    logger.error("[microbilt/webhook] MICROBILT_WEBHOOK_SECRET is not configured — rejecting request");
    return new NextResponse("Webhook not configured", { status: 503 });
  }

  const provided = request.headers.get("x-microbilt-secret") ?? "";
  if (!timingSafeStringEqual(provided, expected)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = (await request.json()) as { buyerId?: string; status?: string; decision?: string };

    if (body.buyerId && body.status === "completed") {
      // Replay dedup: the callback carries no provider event id, so a retried
      // delivery would otherwise create a DUPLICATE buyer notification. Key on the
      // (buyer, status, decision) tuple — a repeat of the same completed decision
      // is suppressed; a genuinely different decision keys separately.
      const decisionKey = (body.decision ?? "").toUpperCase() || "UNKNOWN";
      const claim = await claimProviderEvent({
        provider: "microbilt",
        eventId: `${body.buyerId}:${body.status}:${decisionKey}`,
        eventType: "ibv.completed",
        payload: body,
      });
      if (claim.status === "duplicate") return NextResponse.json({ received: true, duplicate: true });
      if (claim.status === "in_progress") return new NextResponse("Concurrent delivery in progress", { status: 503 });

      const prequal = await prisma.preQualification.findUnique({ where: { buyerId: body.buyerId } });
      if (prequal) {
        // Send an HONEST notification based on the callback's decision. The bug
        // this fixes: the type was hardcoded to PREQUAL_APPROVED, so a DECLINED
        // applicant was told "approved". We do NOT overwrite PreQualification
        // here — the decision is authoritatively set by the synchronous
        // decisioning path (prequal.service); this async callback only notifies.
        const decision = (body.decision ?? "").toUpperCase();
        const notice =
          decision === "APPROVED"
            ? { type: "PREQUAL_APPROVED" as const, title: "You're pre-qualified", body: "Your pre-qualification is complete. View your buying power on your dashboard." }
            : decision === "DECLINED"
              ? { type: "PREQUAL_DECLINED" as const, title: "Pre-qualification decision", body: "Your pre-qualification could not be approved at this time. See your dashboard for details and next steps." }
              : { type: "REQUEST_STATUS_UPDATE" as const, title: "Pre-qualification update", body: "Your pre-qualification status has been updated. Check your dashboard." };
        await prisma.notification.create({
          data: {
            buyerId: body.buyerId,
            title: notice.title,
            body: notice.body,
            type: notice.type,
          },
        }).catch(() => {});
      }
      // Mark the callback processed so a retry is deduped (not re-notified).
      await claim.settle();
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("[microbilt/webhook] processing error:", err);
    return new NextResponse("Processing error", { status: 500 });
  }
}

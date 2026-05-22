// MicroBilt webhook handler for IBV callbacks
//
// MicroBilt's Connect-style callback delivers a shared secret in the
// `x-microbilt-secret` header. We fail closed if the secret is unset so an
// unconfigured webhook cannot accept forged status updates.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

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
    console.error("[microbilt/webhook] MICROBILT_WEBHOOK_SECRET is not configured — rejecting request");
    return new NextResponse("Webhook not configured", { status: 503 });
  }

  const provided = request.headers.get("x-microbilt-secret") ?? "";
  if (!timingSafeStringEqual(provided, expected)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = (await request.json()) as { buyerId?: string; status?: string; decision?: string };

    if (body.buyerId && body.status === "completed") {
      const prequal = await prisma.preQualification.findUnique({ where: { buyerId: body.buyerId } });
      if (prequal) {
        await prisma.notification.create({
          data: {
            buyerId: body.buyerId,
            title: "Pre-qualification update",
            body: "Your prequalification has been updated. Check your dashboard.",
            type: "PREQUAL_APPROVED",
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[microbilt/webhook] processing error:", err);
    return new NextResponse("Processing error", { status: 500 });
  }
}

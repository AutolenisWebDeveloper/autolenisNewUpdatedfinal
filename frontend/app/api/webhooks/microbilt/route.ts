// MicroBilt webhook handler for IBV callbacks
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { buyerId?: string; status?: string; decision?: string };

    if (body.buyerId && body.status === "completed") {
      // Update prequal status based on callback
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
    return new NextResponse("Processing error", { status: 500 });
  }
}

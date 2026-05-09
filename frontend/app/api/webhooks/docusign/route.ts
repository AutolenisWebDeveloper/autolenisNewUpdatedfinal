// DocuSign webhook handler
import { NextRequest, NextResponse } from "next/server";
import { handleEnvelopeCompleted } from "@/lib/services/esign/esign.service";

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.DOCUSIGN_WEBHOOK_SECRET;
  const incomingSecret = request.headers.get("x-docusign-signature-1");

  if (webhookSecret && incomingSecret !== webhookSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json() as { event?: string; data?: { envelopeId?: string } };
    const event = body?.event;
    const envelopeId = body?.data?.envelopeId;

    if (event === "envelope-completed" && envelopeId) {
      await handleEnvelopeCompleted(envelopeId);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("DocuSign webhook error:", err);
    return new NextResponse("Processing error", { status: 500 });
  }
}

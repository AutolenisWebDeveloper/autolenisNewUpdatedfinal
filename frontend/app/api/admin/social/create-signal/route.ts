// POST /api/admin/social/create-signal
// Creates a TopicSignal from an ad-hoc context (e.g. a competitor-gap insight)
// so the generate route — which requires a signalId — has a record to bind to.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: { signalType?: string; signalContext?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const signal = await prisma.topicSignal.create({
    data: {
      signalType: body.signalType ?? "competitor_gap",
      signalContext: (body.signalContext ?? {}) as object,
      assetsGenerated: false,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
  });

  return adminSuccess(signal);
}

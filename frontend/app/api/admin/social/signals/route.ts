// /api/admin/social/signals
//   GET  — list topic signals (?processed=true|false).
//   POST — manually trigger a fresh signal scan.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { scanForTopicSignals } from "@/lib/social/topic-signal.engine";
import type { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const processed = searchParams.get("processed");

  const where: Prisma.TopicSignalWhereInput = {};
  if (processed === "true") where.assetsGenerated = true;
  else if (processed === "false") where.assetsGenerated = false;

  const [signals, total] = await Promise.all([
    prisma.topicSignal.findMany({ where, orderBy: { detectedAt: "desc" }, take: 100 }),
    prisma.topicSignal.count({ where }),
  ]);

  return adminSuccess({ signals, total });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const signals = await scanForTopicSignals();
  await createAuditLog(admin, request, {
    action: "SOCIAL_SIGNAL_SCAN_TRIGGERED",
    entityType: "TopicSignal",
    entityId: "scan",
    metadata: { created: signals.length },
  });

  return adminSuccess({ created: signals.length, signals });
}

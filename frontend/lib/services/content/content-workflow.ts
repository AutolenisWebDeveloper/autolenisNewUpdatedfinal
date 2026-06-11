// Shared helper for appending to the content workflow event log.
// Complements admin_audit_log with content-domain transition detail.

import { prisma } from "@/lib/prisma";

export async function recordWorkflowEvent(params: {
  articleId?: string | null;
  jobId?: string | null;
  eventType: string;
  actor: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await prisma.contentWorkflowEvent.create({
    data: {
      articleId: params.articleId ?? null,
      jobId: params.jobId ?? null,
      eventType: params.eventType,
      actor: params.actor,
      payloadJson: params.payload ? JSON.stringify(params.payload) : null,
    },
  });
}

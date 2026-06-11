// WO-4 — Publishing service.
//
// Publish guardrails (ALL must hold, or an explicit override must be recorded by
// the validation step): the article is approved, its latest ContentValidationResult
// passed (or was overridden), the slug is unique (DB-enforced), and body/meta/FAQ
// are valid. Scheduling is modeled with scheduledAt + approvedAt; the
// content-publisher cron flips due, approved, validated articles to PUBLISHED.

import { prisma } from "@/lib/prisma";
import { snapshot, rollback as rollbackVersion } from "@/lib/services/content/content-version.service";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

export interface PublishGuardResult {
  ok: boolean;
  reasons: string[];
}

function parseFaqOk(faqJson: string | null): boolean {
  if (!faqJson) return true;
  try {
    const parsed = JSON.parse(faqJson);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}

// Evaluate publish guardrails for an already-loaded article id.
export async function evaluatePublishGuards(articleId: string): Promise<PublishGuardResult> {
  const article = await prisma.contentArticle.findUnique({ where: { id: articleId } });
  const reasons: string[] = [];
  if (!article) return { ok: false, reasons: ["article not found"] };

  if (!article.approvedAt) reasons.push("not approved");
  if (!article.body || !article.body.trim()) reasons.push("empty body");
  if (!article.metaDescription || !article.metaDescription.trim()) reasons.push("missing meta description");
  if (!parseFaqOk(article.faqJson)) reasons.push("invalid FAQ JSON");

  const latest = await prisma.contentValidationResult.findFirst({
    where: { articleId },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) reasons.push("never validated");
  else if (!latest.passed) reasons.push("latest validation failed (no override)");

  return { ok: reasons.length === 0, reasons };
}

export async function approveArticle(articleId: string, adminId: string) {
  const article = await prisma.contentArticle.update({
    where: { id: articleId },
    data: { approvedAt: new Date(), approvedByAdminId: adminId },
  });
  await recordWorkflowEvent({ articleId, eventType: "article.approve", actor: adminId });
  return article;
}

export async function publishNow(articleId: string, actor: string) {
  const guards = await evaluatePublishGuards(articleId);
  if (!guards.ok) {
    await prisma.contentArticle.update({
      where: { id: articleId },
      data: { publishFailureReason: guards.reasons.join("; ") },
    });
    await recordWorkflowEvent({
      articleId,
      eventType: "article.publish_blocked",
      actor,
      payload: { reasons: guards.reasons },
    });
    throw new Error(`publish blocked: ${guards.reasons.join("; ")}`);
  }

  const existing = await prisma.contentArticle.findUnique({
    where: { id: articleId },
    select: { publishedAt: true },
  });
  const now = new Date();
  const article = await prisma.contentArticle.update({
    where: { id: articleId },
    data: {
      status: "PUBLISHED",
      publishedAt: existing?.publishedAt ?? now,
      lastPublishedAt: now,
      publishFailureReason: null,
      lifecycleStatus: "ACTIVE",
      scheduledAt: null,
    },
  });

  await snapshot(articleId, { reason: "publish", actor });
  await recordWorkflowEvent({ articleId, eventType: "article.publish", actor });
  return article;
}

// Schedule a future publish. Requires approval first (the cron only publishes
// approved + validated articles).
export async function schedule(articleId: string, when: Date, actor: string) {
  const article = await prisma.contentArticle.update({
    where: { id: articleId },
    data: { scheduledAt: when, publishFailureReason: null },
  });
  await recordWorkflowEvent({
    articleId,
    eventType: "article.schedule",
    actor,
    payload: { scheduledAt: when.toISOString() },
  });
  return article;
}

export async function unpublish(articleId: string, actor: string) {
  const article = await prisma.contentArticle.update({
    where: { id: articleId },
    data: { status: "DRAFT", publishedAt: null },
  });
  await recordWorkflowEvent({ articleId, eventType: "article.unpublish", actor });
  return article;
}

export async function rollback(articleId: string, versionNumber: number, actor: string) {
  const restored = await rollbackVersion(articleId, versionNumber, actor);
  return restored;
}

// Cron helper: publish all due, approved, scheduled articles (bounded). Returns
// per-run counts mirroring the social-publish-queue summary shape.
export async function publishDueScheduled(maxPerRun: number, now = new Date()) {
  const due = await prisma.contentArticle.findMany({
    where: {
      scheduledAt: { lte: now },
      approvedAt: { not: null },
      status: { in: ["DRAFT", "REVIEW_NEEDED"] },
    },
    orderBy: { scheduledAt: "asc" },
    take: maxPerRun,
    select: { id: true, slug: true },
  });

  let published = 0;
  let failed = 0;
  for (const a of due) {
    try {
      await publishNow(a.id, "cron:content-publisher");
      published += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[content-publisher] failed ${a.slug}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { considered: due.length, published, failed, timestamp: now.toISOString() };
}

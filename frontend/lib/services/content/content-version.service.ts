// WO-3 — Versioning service.
//
// A ContentArticleVersion is an immutable snapshot of an article's editorial
// fields. We snapshot on every generate / regenerate / edit / publish / rollback
// so history is durable and rollback is exact.
//
// Versions are append-only: a rollback does not delete newer versions, it
// restores the chosen version's fields onto the live article AND writes a fresh
// snapshot recording the rollback.

import { prisma } from "@/lib/prisma";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

async function nextVersionNumber(articleId: string): Promise<number> {
  const latest = await prisma.contentArticleVersion.findFirst({
    where: { articleId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}

export interface SnapshotMeta {
  reason: string;
  actor: string;
  createdByAdminId?: string | null;
  createdByJobId?: string | null;
  complianceResultJson?: string | null;
  generatedByModel?: string | null;
}

// Snapshot the article's CURRENT editorial fields as a new version.
export async function snapshot(articleId: string, meta: SnapshotMeta) {
  const article = await prisma.contentArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`article ${articleId} not found`);

  const versionNumber = await nextVersionNumber(articleId);
  const version = await prisma.contentArticleVersion.create({
    data: {
      articleId,
      versionNumber,
      title: article.title,
      h1: article.h1,
      metaDescription: article.metaDescription,
      body: article.body,
      faqJson: article.faqJson,
      qualityScore: article.qualityScore,
      complianceResultJson: meta.complianceResultJson ?? null,
      generatedByModel: meta.generatedByModel ?? article.groqModel ?? null,
      createdByAdminId: meta.createdByAdminId ?? null,
      createdByJobId: meta.createdByJobId ?? null,
      changeReason: meta.reason,
    },
  });

  await recordWorkflowEvent({
    articleId,
    eventType: "version.snapshot",
    actor: meta.actor,
    payload: { versionNumber, reason: meta.reason },
  });

  return version;
}

// Restore a prior version's editorial fields onto the live article, bump
// publicationVersion, and append a new snapshot recording the rollback.
export async function rollback(articleId: string, versionNumber: number, actor: string) {
  const target = await prisma.contentArticleVersion.findUnique({
    where: { articleId_versionNumber: { articleId, versionNumber } },
  });
  if (!target) throw new Error(`version ${versionNumber} not found for article ${articleId}`);

  const article = await prisma.contentArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`article ${articleId} not found`);

  await prisma.contentArticle.update({
    where: { id: articleId },
    data: {
      title: target.title,
      h1: target.h1,
      metaDescription: target.metaDescription,
      body: target.body,
      faqJson: target.faqJson,
      qualityScore: target.qualityScore,
      publicationVersion: article.publicationVersion + 1,
    },
  });

  // Append a snapshot of the now-restored state so the timeline is complete.
  const restored = await snapshot(articleId, {
    reason: `rollback to v${versionNumber}`,
    actor,
  });

  await recordWorkflowEvent({
    articleId,
    eventType: "version.rollback",
    actor,
    payload: { restoredFrom: versionNumber, newVersion: restored.versionNumber },
  });

  return restored;
}

export async function listVersions(articleId: string) {
  return prisma.contentArticleVersion.findMany({
    where: { articleId },
    orderBy: { versionNumber: "desc" },
  });
}

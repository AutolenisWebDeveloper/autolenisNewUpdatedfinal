// Signed-contract re-fetch — durability backstop for the DocuSign signed-PDF
// storage step (Batch 6). The `envelope-completed` webhook stores the executed
// PDF INLINE and best-effort: if that single retrieval blips (DocuSign transient
// error, Supabase upload failure, token failure) the envelope is left
// COMPLETED with `documentKey = null` and the buyer's download route 404s
// forever, because nothing retries. This drain re-invokes the same
// `retrieveAndStoreSignedContract` for any completed-but-unstored envelope.
//
// DORMANT without real DocuSign: `retrieveAndStoreSignedContract` returns null
// up front when `isDocuSignConfigured()` is false (the default mock mode), so
// with no real credentials this drain finds nothing to store and no-ops. It is
// wired live so monitoring proves it alive and it self-heals a missed PDF the
// moment real DocuSign is configured.
//
// Idempotent + bounded: only envelopes still missing a `documentKey` are
// selected, so a stored envelope is never re-fetched; a per-envelope failure is
// isolated (logged, counted) and retried on the next run — there is no terminal
// state to corrupt (documentKey is set exactly once, on success).

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { retrieveAndStoreSignedContract } from "@/lib/services/esign/esign.service";

const BATCH = 50;

export interface SignedContractRefetchSummary {
  scanned: number;
  restored: number; // documentKey newly stored
  skipped: number; // no real PDF available yet (mock/unconfigured → null)
  failed: number; // retrieval/upload threw — will retry next run
}

// Re-fetch the executed PDF for every envelope that completed but never stored
// its `documentKey`. Safe to run repeatedly.
export async function refetchMissingSignedContracts(): Promise<SignedContractRefetchSummary> {
  const envelopes = await prisma.eSignEnvelope.findMany({
    where: {
      status: "COMPLETED",
      documentKey: null,
      docusignEnvelopeId: { not: null },
    },
    select: { id: true, dealId: true, docusignEnvelopeId: true },
    orderBy: { completedAt: "asc" },
    take: BATCH,
  });

  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (const env of envelopes) {
    try {
      const documentKey = await retrieveAndStoreSignedContract(env.docusignEnvelopeId as string, env.dealId);
      if (!documentKey) {
        // Mock/unconfigured (or no real envelope) — nothing to store yet.
        skipped++;
        continue;
      }
      // Guarded write: only set documentKey while it is still null, so a
      // concurrent run (or the webhook itself) can't clobber a stored key.
      await prisma.eSignEnvelope.updateMany({
        where: { id: env.id, documentKey: null },
        data: { documentKey },
      });
      restored++;
    } catch (err) {
      logger.error(`[signed-contract-refetch] envelope ${env.id} retrieval failed — will retry:`, err);
      failed++;
    }
  }

  return { scanned: envelopes.length, restored, skipped, failed };
}

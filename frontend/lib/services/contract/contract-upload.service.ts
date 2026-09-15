// lib/services/contract/contract-upload.service.ts
//
// RETIRED BY PHASE 8 (§8.2 Phase 8, defect 5).
//
// `uploadContract` was a SECOND ContractVersion writer. It created a version row with a
// read-then-create version number and nothing else: no Contract Shield scan, no
// supersede of the prior version, no document hash, no deal transition. A contract
// written through it would have sat APPROVED-adjacent and unscanned, and because
// `createContractVersionAndScan` marks every OTHER non-superseded version SUPERSEDED on
// the next real upload, the two writers disagreed about what the version chain even was.
//
// It had ZERO CALLERS — verified across lib/, app/, components/, scripts/ and tests/ —
// so nothing broke by standing it down. That is not a reason to leave it: an uncalled
// writer is a loaded one, and the next engineer looking for "how do I add a contract
// version" would have found the wrong answer in a file named exactly that.
//
// THE ONE PATH is `createContractVersionAndScan` in
// lib/services/dealer/dealer-contract.service.ts, which versions, supersedes, hashes,
// scans and converges the workflow status in the right order.
//
// NOT DELETED, per CLAUDE.md: anything obsolete is REPORTED for an owner decision, never
// removed in passing. The function stays, refuses, and records the attempt so a caller
// that appears later is a row in the LEGACY_PATH_WRITE counter rather than an unscanned
// contract in front of a buyer.

import { recordLegacyPathWrite } from "@/lib/services/comms/legacy-path-write";

export async function uploadContract(
  dealId: string,
  _uploadedBy: string,
  _documentUrl: string,
  _mimeType: string,
  _sizeBytes: number,
): Promise<never> {
  await recordLegacyPathWrite({
    kind: "LEGACY_CONTRACT_APPROVAL",
    detail: "contract-upload.service::uploadContract — stood down, no ContractVersion written",
    entityType: "Deal",
    entityId: dealId,
    removalPhase: 10,
  });
  throw new Error(
    "uploadContract() is retired. It wrote a ContractVersion with no Contract Shield scan, no " +
      "supersede and no document hash. Use uploadDealerContract / uploadContractForDealByAdmin in " +
      "lib/services/dealer/dealer-contract.service.ts, which is the only path that scans what it stores.",
  );
}

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createSignedDocumentUrl } from "@/lib/services/documents/storage-links";

// GET /api/admin/contracts/[versionId]/signed-url
// Short-lived signed URL for a contract version in the private "contracts"
// bucket so the admin contracts hub can actually open what it lists.
export async function GET(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;

  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const version = await prisma.contractVersion.findUnique({ where: { id: versionId } });
  if (!version) return adminError("NOT_FOUND", "Contract version not found", 404);

  // C-57: "Admin can open the held contract under review." It could not. This route signed
  // against a bucket called "contracts"; every ContractVersion.documentUrl is a key in
  // "dealer-contracts" (buyer-signing.service.ts:42, contract-shield/extract-text.ts:13), so
  // the signed URL resolved to nothing and the admin hub's View button returned a storage
  // error on every contract that has ever existed. A reviewer who cannot open the document
  // cannot review it, and Contract Shield's whole hold-for-review path terminates here.
  // §14d — `?variant=executed` serves the DEALERSHIP'S FULLY EXECUTED COPY rather than the
  // approved version. They are different documents and both are needed: the approved version
  // is what Contract Shield judged and the buyer signed; the executed copy is what the
  // dealership countersigned and returned, and §14d requires it stored "and access granted to
  // the buyer, the dealership, and authorized administrators". This route is the
  // administrators' third of that sentence, extended rather than duplicated.
  //
  // A missing key is a 404 that says so, never a silent fall-back to the approved version —
  // handing a reviewer the unexecuted document while labelling it executed is worse than
  // handing them nothing.
  const wantsExecuted = new URL(request.url).searchParams.get("variant") === "executed";
  if (wantsExecuted && !version.executedDocumentKey) {
    return adminError(
      "NOT_EXECUTED",
      "No fully executed copy has been stored against this contract version yet.",
      404,
    );
  }
  const key = wantsExecuted ? version.executedDocumentKey! : version.documentUrl;

  const signedUrl = await createSignedDocumentUrl("dealer-contracts", key);
  if (!signedUrl) return adminError("STORAGE_ERROR", "Unable to generate contract link", 500);

  return adminSuccess({ signedUrl, variant: wantsExecuted ? "executed" : "approved" });
}

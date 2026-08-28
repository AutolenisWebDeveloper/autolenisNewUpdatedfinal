"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/kit";
import { canUse, deniedReason } from "@/lib/auth/admin-ui-roles";

// Row actions for the central e-sign hub. Reuses the same per-deal routes as
// AdminESignActions on the deal detail page (resend + reason-gated void, both
// audit-logged server-side); previously these hub buttons had no handlers.
export default function ESignHubRowActions({
  dealId,
  envelopeId,
  status,
  adminRole,
}: {
  dealId: string;
  envelopeId: string;
  status: string;
  /** UX only — the void route re-checks the role server-side. */
  adminRole?: string;
}) {
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const canResend = status === "SENT" || status === "DELIVERED" || status === "PENDING";
  // Resend is intentionally ungated: its route is auth-only. Void hard-denies
  // to everyone outside the mirrored allow-list, and voiding costs a confirm
  // dialog plus a mandatory reason before the 403 would land.
  const mayVoid = canUse("deal.esign.void", adminRole);
  const canVoid = canResend && mayVoid;

  async function post(path: string, body?: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
    if (!res.ok || !data?.success) throw new Error(data?.error?.message ?? "Request failed");
  }

  async function handleResend() {
    setResending(true);
    try {
      await post(`/api/admin/deals/${dealId}/esign/resend`);
      toast.success("Signing email resent");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resend");
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        data-testid={`resend-envelope-${envelopeId}`}
        disabled={!canResend || resending}
        onClick={handleResend}
      >
        {resending && <Loader2 size={12} className="animate-spin mr-1" aria-hidden />}
        Resend
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-testid={`void-envelope-${envelopeId}`}
        disabled={!canVoid}
        title={mayVoid ? undefined : deniedReason("deal.esign.void")}
        onClick={() => setVoidOpen(true)}
      >
        Void
      </Button>
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void signing envelope?"
        description="The buyer's current signing link stops working immediately. Voiding cannot be undone — a new envelope must be created to restart signing."
        confirmLabel="Void envelope"
        variant="danger"
        requireReason
        reasonPlaceholder="e.g. Buyer requested changes to contract terms"
        onConfirm={async (reason) => {
          try {
            await post(`/api/admin/deals/${dealId}/esign/void`, { reason });
            toast.success("Envelope voided");
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to void envelope");
            throw e;
          }
        }}
        data-testid={`void-envelope-confirm-${envelopeId}`}
      />
    </>
  );
}

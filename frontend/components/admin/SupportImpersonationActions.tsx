"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { canUse, deniedReason } from "@/lib/auth/admin-ui-roles";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/kit";
import { api, apiErrorMessage } from "@/lib/api/client";

// Start/end controls for audited support-impersonation sessions.
// Start requires a documented reason (≥10 chars, server-enforced) and is
// written to the audit log; ending a session is likewise audit-logged.

export function StartImpersonationButton({
  targetUserId,
  targetLabel,
  adminRole,
}: {
  targetUserId: string;
  targetLabel: string;
  adminRole?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Mirrors the ROUTE's allow-list, which is broader than
  // PERMISSION_ROLES["support.impersonate"]. That disagreement is reported as
  // an owner-gated authorization decision; server behaviour is unchanged.
  const mayImpersonate = canUse("support.impersonate", adminRole);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={!mayImpersonate}
        title={mayImpersonate ? undefined : deniedReason("support.impersonate")}
        data-testid={`impersonate-${targetUserId}`}>
        Start session
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Start support session for ${targetLabel}?`}
        description="This records an audited impersonation session (who, why, when). Use it before viewing or acting on the user's account for support."
        confirmLabel="Start session"
        variant="trust"
        requireReason
        reasonPlaceholder="Support ticket / reason (min 10 chars, audit-logged)"
        onConfirm={async (reason) => {
          try {
            await api.post("/api/admin/support/impersonate", { targetUserId, reason });
            toast.success("Impersonation session started");
            router.refresh();
          } catch (e) {
            toast.error(apiErrorMessage(e, "Failed to start session"));
            throw e;
          }
        }}
        data-testid={`impersonate-confirm-${targetUserId}`}
      />
    </>
  );
}

export function EndImpersonationButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function end() {
    setBusy(true);
    try {
      await api.post(`/api/admin/support/impersonation/${sessionId}/end`);
      toast.success("Session ended");
      router.refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Failed to end session"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={end} data-testid={`end-impersonation-${sessionId}`}>
      {busy && <Loader2 size={12} className="animate-spin mr-1" aria-hidden />}
      End session
    </Button>
  );
}

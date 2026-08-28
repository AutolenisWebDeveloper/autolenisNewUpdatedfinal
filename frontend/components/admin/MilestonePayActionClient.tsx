"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { canUse, deniedReason } from "@/lib/auth/admin-ui-roles";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/kit";
import { api, apiErrorMessage } from "@/lib/api/client";

// Wires the previously-inert milestone "Pay" button to the existing
// POST /api/admin/referral-milestones/[id]/pay route (SUPER/FINANCE gated,
// ALREADY_PAID idempotency guard, audit-logged server-side). This records
// that the reward was paid out — it does not move money itself.
export default function MilestonePayActionClient({
  milestoneId,
  milestoneLabel,
  rewardValueCents,
  adminRole,
}: {
  milestoneId: string;
  milestoneLabel: string;
  rewardValueCents: number;
  adminRole?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // UX only — the pay route re-checks the role server-side.
  const mayPay = canUse("referral.milestone.pay", adminRole);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={!mayPay}
        title={mayPay ? undefined : deniedReason("referral.milestone.pay")}
        data-testid={`pay-milestone-${milestoneId}`}
      >
        Mark paid
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Mark milestone reward as paid?"
        description={`This records that the $${(rewardValueCents / 100).toLocaleString()} reward for "${milestoneLabel}" has been paid to the buyer. It does not move money — complete the payout first. This is written to the audit log and cannot be re-marked.`}
        confirmLabel="Mark paid"
        variant="danger"
        requireReason
        reasonPlaceholder="How was this paid? (e.g. payout reference — recorded in the audit log)"
        onConfirm={async (reason) => {
          try {
            await api.post(`/api/admin/referral-milestones/${milestoneId}/pay`, { reason });
            toast.success("Milestone marked paid");
            router.refresh();
          } catch (e) {
            toast.error(apiErrorMessage(e, "Failed to mark milestone paid"));
            throw e;
          }
        }}
        data-testid={`pay-milestone-confirm-${milestoneId}`}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api/client";

// Moderation actions for a single testimonial — calls the (previously
// orphaned) PATCH /api/admin/testimonials/[id] route, which audit-logs
// the decision server-side.
export default function TestimonialModerationActions({
  testimonialId,
  isApproved,
}: {
  testimonialId: string;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function moderate(approved: boolean) {
    setBusy(approved ? "approve" : "reject");
    try {
      await api.patch(`/api/admin/testimonials/${testimonialId}`, { approved });
      toast.success(approved ? "Testimonial approved and published" : "Testimonial unpublished");
      router.refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Failed to update testimonial"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-2 mt-3">
      {!isApproved && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => moderate(true)}
          data-testid={`approve-testimonial-${testimonialId}`}
        >
          {busy === "approve" && <Loader2 size={12} className="animate-spin mr-1" aria-hidden />}
          Approve
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={() => moderate(false)}
        data-testid={`reject-testimonial-${testimonialId}`}
      >
        {busy === "reject" && <Loader2 size={12} className="animate-spin mr-1" aria-hidden />}
        {isApproved ? "Unpublish" : "Reject"}
      </Button>
    </div>
  );
}

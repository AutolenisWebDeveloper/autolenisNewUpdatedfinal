"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/kit";

// Approve/Reject for the dealer-applications list. Replaces the raw
// <form method="POST"> pattern that navigated the admin to a bare JSON
// response; matches the detail-page client behavior (JSON POST + refresh).
export default function ApplicationRowActions({ appId }: { appId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);

  async function post(path: string, body?: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const msg = typeof j?.error === "string"
        ? j.error
        : (j?.error as { message?: string } | undefined)?.message ?? `Request failed (${res.status})`;
      throw new Error(msg);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setConfirm("approve")}
        className="px-3 py-1 bg-green-600 text-white text-xs rounded font-semibold hover:bg-green-700"
        data-testid={`approve-btn-${appId}`}
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => setConfirm("reject")}
        className="px-3 py-1 bg-red-600 text-white text-xs rounded font-semibold hover:bg-red-700"
        data-testid={`reject-btn-${appId}`}
      >
        Reject
      </button>

      {confirm === "approve" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirm(null); }}
          title="Approve this dealer application?"
          description="The dealership is activated on the platform and the applicant receives an approval email."
          confirmLabel="Approve"
          onConfirm={async () => {
            try {
              await post(`/api/admin/dealers/applications/${appId}/approve`);
              toast.success("Application approved");
              router.refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Approve failed");
              throw e;
            }
          }}
          data-testid={`approve-confirm-${appId}`}
        />
      )}
      {confirm === "reject" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirm(null); }}
          title="Reject this dealer application?"
          description="The applicant is emailed an automated rejection notice. This cannot be undone."
          confirmLabel="Reject application"
          variant="danger"
          requireReason
          reasonPlaceholder="Reason (internal + emailed to the applicant)"
          onConfirm={async (reason) => {
            try {
              await post(`/api/admin/dealers/applications/${appId}/reject`, { reason });
              toast.success("Application rejected");
              router.refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Reject failed");
              throw e;
            }
          }}
          data-testid={`reject-confirm-${appId}`}
        />
      )}
    </div>
  );
}

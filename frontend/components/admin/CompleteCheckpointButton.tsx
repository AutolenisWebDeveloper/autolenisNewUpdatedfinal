"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function CompleteCheckpointButton({
  requestId,
  checkpointId,
}: {
  requestId: string;
  checkpointId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      data-testid={`complete-checkpoint-${checkpointId}`}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            const res = await fetch(`/api/admin/requests/${requestId}/checkpoints/${checkpointId}/complete`, {
              method: "POST",
            });
            const json = (await res.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
            if (!res.ok || json?.success === false) {
              throw new Error(json?.error?.message ?? `Failed to complete checkpoint (${res.status})`);
            }
            toast.success("Checkpoint marked complete");
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to complete checkpoint");
          }
        });
      }}
      className="text-xs px-2.5 py-1 rounded-md bg-al-primary text-white font-medium hover:bg-al-primary-hover disabled:opacity-50"
    >
      {pending ? "Completing…" : "Mark Complete"}
    </button>
  );
}

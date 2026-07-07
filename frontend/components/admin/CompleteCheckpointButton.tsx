"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

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
          await fetch(`/api/admin/requests/${requestId}/checkpoints/${checkpointId}/complete`, {
            method: "POST",
          });
          router.refresh();
        });
      }}
      className="text-xs px-2.5 py-1 rounded-md bg-al-primary text-white font-medium hover:bg-al-primary-hover disabled:opacity-50"
    >
      {pending ? "Completing…" : "Mark Complete"}
    </button>
  );
}

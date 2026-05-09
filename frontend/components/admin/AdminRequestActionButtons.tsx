"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function AdminRequestActionButtons({
  requestId,
  status,
}: {
  requestId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function patch(action: string) {
    startTransition(async () => {
      await fetch(`/api/admin/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        data-testid="activate-sourcing-btn"
        disabled={pending || !["SUBMITTED", "INTAKE"].includes(status)}
        onClick={() => patch("ACTIVATE_SOURCING")}
      >
        Activate Sourcing
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        data-testid="close-no-match-btn"
        disabled={pending || status === "CLOSED_NO_MATCH" || status === "DEAL_CREATED" || status === "CANCELLED"}
        onClick={() => patch("CLOSE_NO_MATCH")}
      >
        Close — No Match
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        data-testid="reopen-sourcing-btn"
        disabled={pending || !["OFFER_DECLINED", "CLOSED_NO_MATCH"].includes(status)}
        onClick={() => patch("REOPEN_SOURCING")}
      >
        Reopen Sourcing
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        data-testid="create-deal-btn"
        disabled={pending || status !== "OFFER_ACCEPTED"}
        onClick={() => patch("CREATE_DEAL")}
      >
        Create Deal (Admin Action)
      </Button>
    </>
  );
}

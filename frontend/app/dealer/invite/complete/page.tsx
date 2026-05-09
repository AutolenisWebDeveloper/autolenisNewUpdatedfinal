"use client";

// /dealer/invite/complete — redirects to the canonical /dealer/invite/claim flow.
// The fast-lane complete endpoint was removed because the claim API is the single
// supported entry point for invitation acceptance.

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function DealerInviteCompletePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  useEffect(() => {
    // Preserve token so /dealer/invite/claim can validate and process the invitation.
    const destination = token
      ? `/dealer/invite/claim?token=${encodeURIComponent(token)}`
      : "/dealer/invite/claim";
    router.replace(destination);
  }, [token, router]);

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[#0E0620] to-[#111827] flex items-center justify-center p-4"
      data-testid="dealer-invite-complete-page"
    >
      <p className="text-[#4B5563] text-sm">Redirecting to invitation setup…</p>
    </div>
  );
}

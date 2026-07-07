"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";

export default function DealerMarkAllReadButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/dealer/notifications/mark-all-read", { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      setDone(true);
      router.refresh();
    } catch {
      // Surface the failure instead of leaving the user thinking it worked.
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || done}
      className="inline-flex items-center gap-1.5 min-h-[36px] px-2 -mr-2 rounded-md text-sm font-medium text-al-primary hover:text-al-primary-hover disabled:opacity-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-al-primary/40"
      data-testid="mark-all-read-btn"
    >
      <CheckCheck size={15} />
      {error ? "Retry — try again" : done ? "All read" : loading ? "Marking..." : "Mark all read"}
    </button>
  );
}

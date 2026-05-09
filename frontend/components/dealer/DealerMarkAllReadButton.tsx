"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";

export default function DealerMarkAllReadButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await fetch("/api/dealer/notifications/mark-all-read", { method: "POST" });
      setDone(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || done}
      className="flex items-center gap-1.5 text-sm text-[#0B5FD1] hover:text-[#1A6FE0] disabled:opacity-50 transition-colors font-medium"
      data-testid="mark-all-read-btn"
    >
      <CheckCheck size={15} />
      {done ? "All read" : loading ? "Marking..." : "Mark all read"}
    </button>
  );
}

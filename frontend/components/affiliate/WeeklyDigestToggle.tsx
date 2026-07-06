"use client";

import { useState, useTransition } from "react";

export default function WeeklyDigestToggle({ enabled, affiliateId }: { enabled: boolean; affiliateId: string }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setError(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/affiliate/profile/digest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ affiliateId, weeklyDigestEnabled: next }),
        });
        if (!res.ok) {
          setOn(!next);
          setError(true);
        }
      } catch {
        setOn(!next);
        setError(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={on ? "Disable weekly digest" : "Enable weekly digest"}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          on ? "bg-al-primary" : "bg-slate-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      {error && <span className="text-xs text-red-500">Save failed</span>}
    </div>
  );
}

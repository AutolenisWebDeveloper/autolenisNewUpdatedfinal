"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

interface Props {
  canRequest: boolean;
  missing?: string[];
}

const MISSING_LABELS: Record<string, string> = {
  banking:    "Add payout method in Finance Hub",
  tax:        "Complete W-9 / tax information",
  onboarding: "Onboarding pending admin approval",
};

export default function PayoutRequestButton({ canRequest, missing = [] }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleRequest() {
    if (!canRequest || status === "loading") return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/affiliate/payouts/request", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json?.error?.message ?? "Failed to submit payout request.");
        setStatus("error");
      } else {
        setStatus("success");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        className="flex items-center gap-2 bg-[#059669]/20 border border-[#059669]/40 rounded-xl px-4 py-3 text-sm text-[#059669]"
        data-testid="payout-request-success"
      >
        <CheckCircle2 size={16} className="shrink-0 text-[#059669]" />
        Payout request submitted! Our team will process it shortly.
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleRequest}
        disabled={!canRequest || status === "loading"}
        data-testid="payout-request-btn"
        className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
          canRequest
            ? "bg-white text-al-primary-hover hover:bg-[#F8F9FB] shadow-sm"
            : "bg-white/20 text-white/40 cursor-not-allowed"
        }`}
      >
        {status === "loading" ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Requesting…
          </>
        ) : (
          <>Request Payout</>
        )}
      </button>
      {missing.length > 0 && (
        <ul className="mt-3 space-y-1">
          {missing.map(key => (
            <li key={key} className="text-xs text-amber-700 flex items-center gap-1.5">
              <span className="text-amber-500">⚠</span>
              {MISSING_LABELS[key] ?? key}
            </li>
          ))}
        </ul>
      )}
      {status === "error" && (
        <p className="text-xs text-red-300 mt-2 text-center" data-testid="payout-request-error">
          {errorMsg}
        </p>
      )}
    </div>
  );
}

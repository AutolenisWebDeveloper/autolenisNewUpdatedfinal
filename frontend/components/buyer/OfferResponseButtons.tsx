"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Props {
  offerId:   string;
  requestId: string;
}

export default function OfferResponseButtons({ offerId, requestId }: Props) {
  const router = useRouter();
  const [acting, setActing] = useState<"ACCEPT" | "DECLINE" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function respond(action: "ACCEPT" | "DECLINE") {
    setActing(action);
    setErr(null);
    try {
      const res = await fetch(
        `/api/buyer/requests/${requestId}/offer/respond`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ response: action, offerId }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setErr(errData?.error?.message ?? "We couldn't submit your response. Please try again.");
        setActing(null);
        return;
      }
      const data = await res.json() as {
        status:    string;
        redirect?: string | null;
        message?:  string;
      };
      if (data.redirect) {
        router.push(data.redirect);
      } else {
        router.refresh();
      }
    } catch {
      setErr("Something went wrong. Please try again.");
      setActing(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <button
          onClick={() => respond("ACCEPT")}
          disabled={!!acting}
          data-testid="accept-offer-btn"
          className="flex-1 h-12 rounded-xl bg-[#0B5FD1] text-white font-bold text-sm
            flex items-center justify-center gap-2
            hover:bg-[#0944A8] disabled:opacity-40 transition-colors"
        >
          {acting === "ACCEPT"
            ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
            : <><CheckCircle2 size={16} /> Choose This Option</>}
        </button>
        <button
          onClick={() => respond("DECLINE")}
          disabled={!!acting}
          data-testid="decline-offer-btn"
          className="flex-1 h-12 rounded-xl border-2 border-slate-200
            text-slate-700 font-bold text-sm
            flex items-center justify-center gap-2
            hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          {acting === "DECLINE"
            ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
            : <><XCircle size={16} /> Decline</>}
        </button>
      </div>
      {err && <p className="text-xs text-red-500 text-center">{err}</p>}
    </div>
  );
}

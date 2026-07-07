"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

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
      const { redirect } = await api.post<{ status: string; redirect?: string | null; message?: string }>(
        `/api/buyer/requests/${requestId}/offer/respond`,
        { response: action, offerId },
      );
      if (redirect) {
        router.push(redirect);
      } else {
        router.refresh();
      }
    } catch (err) {
      setErr(apiErrorMessage(err, "We couldn't submit your response. Please try again."));
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
          className="flex-1 h-12 rounded-xl bg-al-primary text-white font-bold text-sm
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

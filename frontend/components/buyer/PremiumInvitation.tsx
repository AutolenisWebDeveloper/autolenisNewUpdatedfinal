"use client";

// §23.2a TOUCHPOINT 3 — the post-acceptance Premium invitation, and the only consumer of
// `/api/buyer/plan/invitation`.
//
// FOUND MISSING BY REVIEW. The route, the suppression set, the impression/dismissal record and the
// touchpoint-4 follow-up were all built and nothing anywhere called the route — so the invitation
// was never shown, no dismissal was ever recorded, and touchpoint 4 (which fires ONLY on a
// dismissal) could never fire either. Two of §23.2a's five asks were unreachable.
//
// THE THREE PROPERTIES THE OWNER RULED, restated here because this component is where two of them
// are actually kept:
//
//   IT NEVER BLOCKS. This mounts on a page the buyer reaches only AFTER the selection has
//   committed, and it fetches in an effect. The Deal is rendered and complete before this asks
//   anything; a failure here renders nothing and is logged nowhere the buyer can see.
//
//   IT NEVER DELAYS THE REAFFIRMATION REQUEST. The reaffirmation seam is enqueued on the selection
//   path, server-side, before this component has been mounted at all.
//
//   IT IS SHOWN ONCE. Enforced on the SERVER — the GET records the impression as part of deciding
//   to show it — so a refresh, a second tab, or a client that renders and crashes cannot produce a
//   second showing. This component does not get a vote.
//
// PAY-72 GOVERNS THE COPY: "never sold on fear". Nothing here may suggest the deal goes worse, or
// slower, or less safely on Standard. None of that is true. So it names what Premium ADDS, says
// the deposit already counts toward it, and makes declining a plain, equal choice rather than a
// greyed-out afterthought.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Quote {
  dueCents: number;
  creditCents: number;
  grossCents: number;
}

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function PremiumInvitation({ dealId }: { dealId: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/buyer/plan/invitation?dealId=${encodeURIComponent(dealId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: { show?: boolean; balance?: Quote } };
        if (cancelled || !body.data?.show || !body.data.balance) return;
        setQuote(body.data.balance);
        setOpen(true);
      } catch {
        // Silent by design. The buyer has a Deal; an upsell that could not load is not something
        // to tell them about, and the server has already recorded whatever it decided.
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  const dismiss = useCallback(() => {
    // Closed immediately, reported afterwards. The dismissal is what schedules touchpoint 4, and a
    // buyer who clicked "not now" should not watch a spinner to find out whether it was heard.
    setOpen(false);
    void fetch("/api/buyer/plan/invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId, action: "dismiss" }),
    }).catch(() => {});
  }, [dealId]);

  // Escape closes it, which is the same decision as "Not now" — §23.2b treats a dismissal and a
  // decline identically, so there is no quieter way out that avoids recording one.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open || !quote) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="premium-invitation-title"
      data-testid="premium-invitation"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="premium-invitation-title" className="text-lg font-bold text-slate-900">
            Your deal is locked in.
          </h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            data-testid="premium-invitation-close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-al-primary"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-600">
          Everything from here — financing, paperwork, Contract Shield, signing and pickup — is
          yours on your current plan, and nothing about this deal changes if you stay on it.
        </p>
        <p className="mb-5 text-sm text-slate-600">
          If you&apos;d rather hand the rest to a concierge who does it with you, Premium is{" "}
          <span className="font-semibold text-slate-800">{usd(quote.dueCents)}</span> more
          {quote.creditCents > 0 && <> — your {usd(quote.creditCents)} deposit already counts toward it</>}.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button href="/buyer/plan/premium" className="sm:flex-1" data-testid="premium-invitation-accept">
            See what&apos;s included
          </Button>
          <Button
            variant="secondary"
            className="sm:flex-1"
            onClick={dismiss}
            data-testid="premium-invitation-dismiss"
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

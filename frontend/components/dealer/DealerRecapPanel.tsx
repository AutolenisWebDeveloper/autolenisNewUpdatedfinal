"use client";

// §Stage 11 — the recap's DEALERSHIP half.
//
// WHY THIS COMPONENT EXISTS, and it is the blunt reason. `POST /api/dealer/deals/[dealId]/recap`
// shipped with no surface behind it: the dealership's own "recap ready" email linked to
// `/dealer/deals/{id}`, and that page had no recap block and no RECAP_PENDING case in its
// next-action switch. §Stage 11's exit is "Buyer confirms. Dealership confirms." — so the buyer
// confirmed, `bothConfirmed` stayed false because `dealerConfirmedAt` was null, the deal never
// advanced to FINANCING_PENDING, and no cron or sweep looks at RECAP_PENDING. Every deal that
// reached this stage stopped here permanently, and the dealership following its email saw a
// progress bar and nothing to do.
//
// WHAT IT DELIBERATELY DOES NOT DO. There is no per-product accept/decline here. §11a assigns that
// decision to the BUYER — "separately accepted or declined BY THE BUYER at this stage" — so the
// dealership sees what it quoted and what the buyer decided, and confirms or disputes the figures.
// A dealership control over the buyer's product decisions would be the §11a defect, not a feature.
//
// A DISPUTE NEEDS A REASON, and the server enforces a ten-character minimum. That is not a form
// nicety: the disputed figure goes on the record and the next version is built for someone to
// correct, so "wrong" tells the corrector nothing.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";

export interface DealerRecapLine {
  key: string;
  label: string;
  amountCents: number;
}

export interface DealerRecapProduct {
  key: string;
  label: string;
  amountCents: number;
  accepted: boolean | null;
}

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function DealerRecapPanel({
  dealId,
  version,
  lines,
  otdCents,
  products,
  amountFinancedCents,
  financingPath,
  dealerConfirmedAt,
  buyerConfirmedAt,
  disputeReason,
  frozen,
}: {
  dealId: string;
  version: number;
  lines: DealerRecapLine[];
  otdCents: number | null;
  products: DealerRecapProduct[];
  amountFinancedCents: number | null;
  financingPath: string | null;
  dealerConfirmedAt: string | null;
  buyerConfirmedAt: string | null;
  disputeReason: string | null;
  frozen: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"confirm" | "dispute" | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const confirmed = dealerConfirmedAt !== null;

  async function send(action: "CONFIRM" | "DISPUTE") {
    setBusy(action === "CONFIRM" ? "confirm" : "dispute");
    setError(null);
    try {
      const res = await fetch(`/api/dealer/deals/${dealId}/recap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "CONFIRM" ? { action } : { action, reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? "We could not record that.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not record that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="dealer-recap-heading"
      className="rounded-al-lg border-2 border-al-primary/30 bg-al-surface"
      data-testid="dealer-recap-panel"
    >
      <header className="border-b border-al-border bg-al-primary-subtle px-5 py-4">
        <h2 id="dealer-recap-heading" className="text-[18px] font-semibold text-al-text">
          Confirm the final numbers
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-al-text-muted">
          Version {version} of this deal&apos;s recap. Both you and the buyer confirm it before the
          contract is requested. If a figure is wrong, dispute it and say which one — we will send a
          corrected version rather than change this one.
        </p>
      </header>

      <div className="space-y-4 px-5 py-5">
        <table className="w-full text-[14px]" data-testid="dealer-recap-lines">
          <caption className="sr-only">Itemised out-the-door total, version {version}</caption>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b border-al-border last:border-0">
                <th scope="row" className="py-2 text-left font-normal text-al-text-muted">
                  {line.label}
                </th>
                <td className="py-2 text-right tabular-nums text-al-text" data-testid={`recap-line-${line.key}`}>
                  {money(line.amountCents)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-al-border-strong">
              <th scope="row" className="py-2.5 text-left font-semibold text-al-text">
                Out-the-door
              </th>
              <td className="py-2.5 text-right font-semibold tabular-nums text-al-text" data-testid="recap-otd">
                {money(otdCents)}
              </td>
            </tr>
            {financingPath !== "CASH" && (
              <tr>
                <th scope="row" className="py-2 text-left font-normal text-al-text-muted">
                  Amount financed
                </th>
                <td className="py-2 text-right tabular-nums text-al-text" data-testid="recap-financed">
                  {money(amountFinancedCents)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {products.length > 0 && (
          <div data-testid="dealer-recap-products">
            <p className="text-[14px] font-medium text-al-text">Optional products</p>
            <p className="mb-2 text-[13px] leading-relaxed text-al-text-subtle">
              The buyer accepts or declines each one by name. Anything still undecided keeps the
              recap open — it may not first appear in the contract.
            </p>
            <ul className="space-y-1.5">
              {products.map((p) => (
                <li
                  key={p.key}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]"
                  data-testid={`dealer-recap-product-${p.key}`}
                >
                  <span className="text-al-text">
                    {p.label} — {money(p.amountCents)}
                  </span>
                  <span className="text-[13px] font-medium text-al-text-muted">
                    {p.accepted === true ? "Accepted" : p.accepted === false ? "Declined" : "Not yet decided"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {disputeReason && (
          <p
            className="rounded-al-md border border-al-warning/30 bg-al-warning-subtle px-4 py-3 text-[14px] leading-relaxed text-al-warning-fg"
            data-testid="dealer-recap-prior-dispute"
          >
            The previous version was disputed: {disputeReason}
          </p>
        )}

        <p className="text-[13px] leading-relaxed text-al-text-subtle" data-testid="dealer-recap-status">
          {buyerConfirmedAt ? "The buyer has confirmed this version." : "The buyer has not confirmed this version yet."}
        </p>

        {frozen && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] leading-relaxed text-al-danger-fg"
            data-testid="dealer-recap-frozen"
          >
            <AlertCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            This deal has been disputed more times than this stage allows and is with our Operations
            team. Neither side can confirm it until they have reviewed it.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] text-al-danger-fg"
            data-testid="dealer-recap-error"
          >
            {error}
          </p>
        )}

        {confirmed ? (
          <p
            className="flex items-center gap-2 rounded-al-md border border-al-success/30 bg-al-success-subtle px-4 py-3 text-[14px] font-medium text-al-success-fg"
            data-testid="dealer-recap-confirmed"
          >
            <Check size={15} aria-hidden="true" />
            You confirmed this recap. {buyerConfirmedAt ? "The deal has moved on to financing." : "We are waiting on the buyer."}
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => send("CONFIRM")}
              disabled={busy !== null || frozen}
              data-testid="dealer-recap-confirm"
              className="min-h-[52px] flex-1 rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg transition-colors hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle"
            >
              {busy === "confirm" ? "Confirming…" : "These figures are correct"}
            </button>
            <button
              type="button"
              onClick={() => setDisputeOpen((v) => !v)}
              disabled={busy !== null || frozen}
              aria-expanded={disputeOpen}
              aria-controls="dealer-recap-dispute"
              data-testid="dealer-recap-dispute-toggle"
              className="min-h-[52px] flex-1 rounded-al-md border border-al-border-strong px-5 py-3 text-[15px] font-medium text-al-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-al-text-subtle"
            >
              A figure is wrong
            </button>
          </div>
        )}

        {disputeOpen && !confirmed && (
          <div id="dealer-recap-dispute" className="space-y-2" data-testid="dealer-recap-dispute">
            <label htmlFor="dealer-dispute-reason" className="block text-[14px] font-medium text-al-text">
              Which figure is wrong, and what should it be?
            </label>
            <textarea
              id="dealer-dispute-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-al-md border border-al-border-strong bg-al-surface px-3 py-2.5 text-[15px] text-al-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
              data-testid="dealer-dispute-reason"
            />
            <button
              type="button"
              onClick={() => send("DISPUTE")}
              disabled={reason.trim().length < 10 || busy !== null}
              data-testid="dealer-recap-dispute-submit"
              className="min-h-[48px] w-full rounded-al-md bg-al-text px-5 py-3 text-[15px] font-semibold text-al-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle"
            >
              {busy === "dispute" ? "Sending…" : "Send this back for correction"}
            </button>
            <p className="text-[13px] leading-relaxed text-al-text-subtle">
              Ten characters or more, so whoever corrects it knows what to change.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

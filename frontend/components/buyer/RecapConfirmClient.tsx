"use client";

// §Stage 11 — the recap's interactive half: each optional product accepted or declined, then one
// confirm, or a dispute.
//
// §11a IS THE DESIGN CONSTRAINT: "Every warranty, service contract, GAP product, maintenance plan,
// protection package, or other dealer product is separately named, separately priced, and
// separately accepted or declined by the buyer at this stage. An optional product may never first
// appear in the contract."
//
// So each product gets ITS OWN pair of buttons rather than a checkbox list with one submit. A
// checkbox left unticked is ambiguous — did the buyer decline it, or not reach it? — and §11a's
// whole point is that silence is not an answer. Accept and Decline are both explicit, the
// undecided state is visibly undecided, and Confirm stays disabled while any remain.
//
// THE RUNNING TOTAL MOVES WITH THE DECISIONS, because a buyer deciding on a $1,200 service
// contract is deciding about their out-the-door number, and making them hold the arithmetic is how
// a product gets accepted by accident.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, AlertCircle } from "lucide-react";
import { recapTotals, type RecapProduct } from "@/lib/services/deal/recap-totals";

export type { RecapProduct };

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function RecapConfirmClient({
  dealId,
  products: initialProducts,
  baseOtdCents,
  alreadyConfirmed,
}: {
  dealId: string;
  products: RecapProduct[];
  baseOtdCents: number;
  alreadyConfirmed: boolean;
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [action, setAction] = useState<"confirm" | "dispute" | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const undecided = products.filter((p) => p.accepted === null);
  const { vehicleAndFeesCents, acceptedTotal, declinedTotal, undecidedTotal, runningTotalCents } =
    recapTotals(baseOtdCents, products);

  async function post(body: unknown): Promise<Response> {
    const res = await fetch(`/api/buyer/deal/${dealId}/recap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({}));
      throw new Error(parsed?.error?.message ?? "Something went wrong. Please try again.");
    }
    return res;
  }

  async function decide(productKey: string, accepted: boolean) {
    setBusyKey(productKey);
    setError(null);
    try {
      await post({ action: "DECIDE_PRODUCT", productKey, accepted });
      setProducts((prev) => prev.map((p) => (p.key === productKey ? { ...p, accepted } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirm() {
    setAction("confirm");
    setError(null);
    try {
      await post({ action: "CONFIRM" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not record your confirmation. Please try again.");
      setAction(null);
    }
  }

  async function dispute() {
    setAction("dispute");
    setError(null);
    try {
      await post({ action: "DISPUTE", reason: disputeReason });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not record your dispute. Please try again.");
      setAction(null);
    }
  }

  return (
    <div className="space-y-6" data-testid="recap-confirm">
      <section
        aria-labelledby="products-heading"
        className="rounded-al-lg border border-al-border bg-al-surface"
      >
        <header className="border-b border-al-border px-5 py-4 sm:px-6">
          <h2 id="products-heading" className="text-[17px] font-semibold text-al-text">
            Optional products
          </h2>
          <p className="mt-1 text-[14px] leading-relaxed text-al-text-muted">
            Accept or decline each one. Nothing you decline can appear in your contract later — if
            it does, we hold the contract.
          </p>
        </header>

        {products.length === 0 ? (
          // EMPTY STATE: a recap with no optional products is common and correct, and must not
          // read as a page that failed to load.
          <p
            className="px-5 py-5 text-[14px] leading-relaxed text-al-text-muted sm:px-6"
            data-testid="recap-no-products"
          >
            The dealership has not added any optional products to this deal. There is nothing to
            accept or decline here.
          </p>
        ) : (
          <ul className="divide-y divide-al-border">
            {products.map((p) => (
              <li
                key={p.key}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                data-testid={`recap-product-${p.key}`}
              >
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-al-text">{p.label}</p>
                  <p className="text-[14px] tabular-nums text-al-text-muted">{money(p.amountCents)}</p>
                </div>
                <div
                  className="flex shrink-0 gap-2"
                  role="group"
                  aria-label={`Accept or decline ${p.label}`}
                >
                  <button
                    type="button"
                    onClick={() => decide(p.key, true)}
                    disabled={busyKey === p.key || alreadyConfirmed}
                    aria-pressed={p.accepted === true}
                    data-testid={`recap-accept-${p.key}`}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-al-md border px-4 py-2 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                      p.accepted === true
                        ? "border-al-success bg-al-success-subtle text-al-success-fg"
                        : "border-al-border-strong bg-al-surface text-al-text hover:border-al-text-subtle"
                    }`}
                  >
                    <Check size={14} aria-hidden="true" />
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(p.key, false)}
                    disabled={busyKey === p.key || alreadyConfirmed}
                    aria-pressed={p.accepted === false}
                    data-testid={`recap-decline-${p.key}`}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-al-md border px-4 py-2 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                      p.accepted === false
                        ? "border-al-text-subtle bg-al-bg text-al-text-muted"
                        : "border-al-border-strong bg-al-surface text-al-text hover:border-al-text-subtle"
                    }`}
                  >
                    <X size={14} aria-hidden="true" />
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {products.length > 0 && (
          <div className="border-t border-al-border bg-al-bg px-5 py-4 text-[14px] sm:px-6">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-al-text-muted">Vehicle and fees</dt>
              <dd className="tabular-nums text-al-text" data-testid="recap-vehicle-and-fees">
                {money(vehicleAndFeesCents)}
              </dd>
              <dt className="text-al-text-muted">Optional products you accepted</dt>
              <dd className="tabular-nums text-al-text" data-testid="recap-accepted-total">
                {money(acceptedTotal)}
              </dd>
              {declinedTotal > 0 && (
                <>
                  <dt className="text-al-text-subtle">Declined (not in your total)</dt>
                  <dd
                    className="tabular-nums text-al-text-subtle line-through"
                    data-testid="recap-declined-total"
                  >
                    {money(declinedTotal)}
                  </dd>
                </>
              )}
              {undecidedTotal > 0 && (
                <>
                  <dt className="text-al-text-subtle">Still to decide (not in your total yet)</dt>
                  <dd className="tabular-nums text-al-text-subtle" data-testid="recap-undecided-total">
                    {money(undecidedTotal)}
                  </dd>
                </>
              )}
              <dt className="mt-1 border-t border-al-border pt-1 font-semibold text-al-text">
                Your out-the-door total
              </dt>
              <dd
                className="mt-1 border-t border-al-border pt-1 text-right font-bold tabular-nums text-al-text"
                data-testid="recap-running-total"
              >
                {money(runningTotalCents)}
              </dd>
            </dl>
          </div>
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] text-al-danger-fg"
          data-testid="recap-error"
        >
          {error}
        </p>
      )}

      {alreadyConfirmed ? (
        <p
          className="rounded-al-md border border-al-success/30 bg-al-success-subtle px-4 py-3 text-[14px] text-al-success-fg"
          data-testid="recap-already-confirmed"
        >
          You have confirmed these numbers. We are waiting on the dealership to confirm too.
        </p>
      ) : (
        <section className="rounded-al-lg border border-al-border bg-al-surface px-5 py-5 sm:px-6">
          {undecided.length > 0 && (
            <p
              className="mb-4 inline-flex items-start gap-2 text-[14px] leading-relaxed text-al-warning-fg"
              data-testid="recap-undecided-notice"
            >
              <AlertCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              {undecided.length === 1
                ? "One optional product still needs an answer before you can confirm."
                : `${undecided.length} optional products still need an answer before you can confirm.`}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={confirm}
              disabled={undecided.length > 0 || action !== null}
              data-testid="recap-confirm"
              className="min-h-[52px] rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg transition-colors hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle"
            >
              {action === "confirm" ? "Confirming…" : "These numbers are right — confirm"}
            </button>
            <button
              type="button"
              onClick={() => setDisputeOpen((v) => !v)}
              disabled={action !== null}
              aria-expanded={disputeOpen}
              data-testid="recap-dispute-toggle"
              className="min-h-[52px] rounded-al-md border-2 border-al-border-strong bg-al-surface px-5 py-3 text-[15px] font-semibold text-al-text transition-colors hover:border-al-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            >
              Something is wrong
            </button>
          </div>

          {disputeOpen && (
            <div className="mt-4" data-testid="recap-dispute-panel">
              <label htmlFor="dispute-reason" className="text-[14px] font-medium text-al-text">
                Which figure is wrong, and what should it be?
              </label>
              <textarea
                id="dispute-reason"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-al-md border border-al-border-strong bg-al-surface px-3 py-2 text-[15px] text-al-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
                data-testid="recap-dispute-reason"
              />
              <p className="mt-2 text-[13px] leading-relaxed text-al-text-subtle">
                This goes back to the dealership for correction and produces a new version of your
                recap. The version you are looking at is kept on the record.
              </p>
              <button
                type="button"
                onClick={dispute}
                disabled={disputeReason.trim().length < 10 || action !== null}
                data-testid="recap-dispute-submit"
                className="mt-3 min-h-[48px] rounded-al-md bg-al-warning px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle"
              >
                {action === "dispute" ? "Sending…" : "Send this back for correction"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Buyer — §Stage 12. Choose a financing path, and see the terms-locked checkpoint.
//
// CRITICAL: maxOtdAmountCents is READ-ONLY — no control here emits or modifies it.
//
// PHASE 7 CHANGED WHAT SAVING MEANS HERE, and the copy had to change with it. Before this phase,
// saving a path called `PATCH /api/buyer/deal/financing`, which ADVANCED the deal to FEE_PENDING —
// so the success screen said "Continue to Fee Payment" and it was true. §12c is explicit that
// "the buyer can never mark financing completed", and a buyer who advances past the checkpoint has
// satisfied it themselves whatever the status column says. The PATCH now records the path and
// advances nothing.
//
// So the screen tells the truth about who does what next: the buyer chooses the path, Finance or
// Operations locks the terms against the lender's own evidence, and the contract follows. A
// success screen that promised a next step the buyer cannot take would be the same defect in the
// UI that the route had in code.
//
// §12a's TWO CHECKPOINTS are shown as two, because the difference is the thing buyers get wrong:
// terms locked is not funded, and the vehicle does not move on the first one.

"use client";

import { logger } from "@/lib/logger";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, CreditCard, Lock, ShieldCheck, AlertCircle } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

const FINANCING_PATHS = [
  {
    id: "DEALER",
    label: "Dealer-arranged financing",
    desc: "The dealership arranges the loan with its own lenders. AutoLenis coordinates, follows up and verifies — the loan itself is between you and that lender.",
  },
  {
    id: "EXTERNAL",
    label: "Your own bank or credit union",
    desc: "You bring a pre-approval from your own lender. Send us the approval letter and we attach it to your deal.",
  },
  {
    id: "CASH",
    label: "Cash purchase",
    desc: "No loan to arrange. The dealership confirms the funds are received before the vehicle is released.",
  },
];

interface FinancingState {
  financingPath?: string | null;
  termsLockedAt?: string | null;
  financing?: {
    status: string;
    lenderName: string | null;
    approvedAmountCents: number | null;
    aprRate: number | null;
    termMonths: number | null;
    monthlyPaymentCents: number | null;
    expiresAt: string | null;
    failureReason: string | null;
  } | null;
}

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function FinancingPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialPath, setInitialPath] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<FinancingState | null>(null);

  useEffect(() => {
    api
      .get<FinancingState>("/api/buyer/deal/financing")
      .then((data) => {
        setState(data ?? null);
        if (data?.financingPath) {
          setSelected(data.financingPath);
          setInitialPath(data.financingPath);
        }
      })
      .catch((err: unknown) => {
        logger.error("[financing] Failed to load the financing checkpoint:", err);
        // A QUERY FAILURE RENDERS AS A FAILURE, never as "no path chosen". A buyer shown an empty
        // picker because the load failed would re-choose a path they had already chosen.
        setLoadError(apiErrorMessage(err, "We couldn't load your financing details. Please refresh."));
      })
      .finally(() => setLoadingInitial(false));
  }, []);

  async function saveChoice() {
    if (!selected) return;
    setLoading(true);
    setSaveError(null);
    try {
      await api.patch("/api/buyer/deal/financing", { financingPath: selected });
      setSaved(true);
    } catch (err) {
      setSaveError(apiErrorMessage(err, "We couldn't save your financing choice. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  // LOADING — a skeleton of the real shape, so the page does not jump when it arrives.
  if (loadingInitial) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="financing-loading">
        <div className="h-7 w-56 bg-slate-100 rounded-md animate-pulse mb-2" />
        <div className="h-4 w-72 bg-slate-100 rounded-md animate-pulse mb-6" />
        <div className="space-y-3 mb-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="financing-load-error">
        <h1 className="text-xl font-bold text-slate-900 mb-2">Financing</h1>
        <p role="alert" className="text-sm text-al-danger-fg bg-al-danger-subtle border border-al-danger/30 px-4 py-3 rounded-al-md">
          {loadError}
        </p>
      </div>
    );
  }

  const financing = state?.financing ?? null;
  const locked = financing?.status === "TERMS_LOCKED" || financing?.status === "NOT_REQUIRED_CASH";
  const failed = financing?.status === "FAILED" || financing?.status === "EXPIRED";

  // TERMS LOCKED — §12a's first checkpoint, met. The second is named so the buyer knows the
  // vehicle has not yet been paid for.
  if (locked) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="financing-terms-locked">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-al-success-subtle flex items-center justify-center">
            <Lock size={18} className="text-al-success" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {financing?.status === "NOT_REQUIRED_CASH" ? "Cash purchase confirmed" : "Your terms are locked"}
          </h1>
        </div>
        {financing?.status !== "NOT_REQUIRED_CASH" && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm mb-5 border border-al-border rounded-al-md p-4 bg-al-surface">
            <dt className="text-al-text-muted">Lender</dt>
            <dd className="text-al-text">{financing?.lenderName ?? "—"}</dd>
            <dt className="text-al-text-muted">Approved amount</dt>
            <dd className="tabular-nums text-al-text">{money(financing?.approvedAmountCents)}</dd>
            <dt className="text-al-text-muted">APR</dt>
            <dd className="tabular-nums text-al-text">
              {financing?.aprRate != null ? `${financing.aprRate.toFixed(2)}%` : "—"}
            </dd>
            <dt className="text-al-text-muted">Term</dt>
            <dd className="tabular-nums text-al-text">
              {financing?.termMonths ? `${financing.termMonths} months` : "—"}
            </dd>
            <dt className="text-al-text-muted">Monthly payment</dt>
            <dd className="tabular-nums text-al-text">
              {financing?.monthlyPaymentCents ? `${money(financing.monthlyPaymentCents)}/mo` : "—"}
            </dd>
          </dl>
        )}
        <CheckpointExplainer stage="locked" />
      </div>
    );
  }

  // FAILED or EXPIRED — §Stage 12: "It does not automatically cancel the Deal."
  if (failed) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="financing-failed">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-al-warning-subtle flex items-center justify-center">
            <AlertCircle size={18} className="text-al-warning" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {financing?.status === "EXPIRED" ? "Your approval expired" : "That lender did not work out"}
          </h1>
        </div>
        <p className="text-sm text-al-text-muted leading-relaxed mb-4">
          Your deal is not cancelled.{" "}
          {financing?.failureReason ? `Reason given: ${financing.failureReason}. ` : ""}
          We try another path — a different lender, a different structure, a larger down payment, or
          cash. Our team owns this and will tell you plainly what is being tried and by when.
        </p>
        <p className="text-sm text-al-text-muted leading-relaxed">
          We are also re-checking the dealership&apos;s hold on your vehicle and will have it
          extended or released.
        </p>
      </div>
    );
  }

  if (saved) {
    return (
      <div className="p-6 md:p-8 max-w-lg" data-testid="financing-saved">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-al-success-subtle flex items-center justify-center">
            <CheckCircle2 size={20} className="text-al-success" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Your path is recorded</h1>
        </div>
        <p className="text-sm text-al-text-muted leading-relaxed mb-5">
          {selected === "CASH"
            ? "A cash purchase needs no lender. The dealership confirms your funds are received before the vehicle is released."
            : "Next, our team verifies the terms with the lender — approved amount, APR, term, payment and expiry — and locks them so the dealership can prepare your contract."}
        </p>
        <CheckpointExplainer stage="path" />
        <p className="text-xs text-al-text-subtle mt-4">
          You can change your financing path at any time before your contract is prepared.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="financing-page">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Choose your financing</h1>
      <p className="text-sm text-slate-500 mb-6">
        All financing happens outside AutoLenis. We refer, coordinate, follow up and verify — we
        never take an application or pull your credit.
      </p>

      <fieldset className="space-y-3 mb-6">
        <legend className="sr-only">Financing path</legend>
        {FINANCING_PATHS.map((path) => (
          <button
            key={path.id}
            type="button"
            onClick={() => setSelected(path.id)}
            aria-pressed={selected === path.id}
            data-testid={`financing-option-${path.id.toLowerCase()}`}
            className={`w-full text-left p-5 rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 ${
              selected === path.id
                ? "border-al-primary bg-al-primary/5"
                : "border-slate-200 hover:border-slate-300 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{path.label}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{path.desc}</p>
              </div>
              {selected === path.id && (
                <CheckCircle2 size={18} className="text-al-primary shrink-0 mt-0.5" aria-hidden="true" />
              )}
            </div>
          </button>
        ))}
      </fieldset>

      <div className="flex items-center justify-between mb-6 p-3 bg-slate-50 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <CreditCard size={14} className="text-al-primary" aria-hidden="true" />
          <span>Pre-approvals &amp; payment calculator</span>
        </div>
        <Link
          href="/buyer/deal/financing/pre-approval"
          data-testid="view-pre-approval-link"
          className="text-xs text-al-primary font-semibold hover:underline flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
        >
          Open <ArrowRight size={11} aria-hidden="true" />
        </Link>
      </div>

      {saveError && (
        <p
          role="alert"
          className="text-sm text-al-danger-fg bg-al-danger-subtle border border-al-danger/30 px-3 py-2 rounded-md mb-3"
          data-testid="financing-save-error"
        >
          {saveError}
        </p>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={saveChoice}
        disabled={!selected || loading}
        data-testid="financing-save-btn"
      >
        {loading ? "Saving…" : initialPath ? "Update my financing path" : "Confirm my financing path"}{" "}
        <ArrowRight size={15} aria-hidden="true" />
      </Button>

      <div className="mt-6">
        <CheckpointExplainer stage="path" />
      </div>
    </div>
  );
}

/**
 * §12a — "Why financing is two checkpoints, not one", in the buyer's words.
 *
 * Shown at every stage of this screen because the misunderstanding it prevents — "my financing is
 * approved, so the car is mine" — is the one that makes a buyer show up at a dealership expecting
 * to drive away. The current checkpoint is marked; the other is named, not hidden.
 */
function CheckpointExplainer({ stage }: { stage: "path" | "locked" }) {
  return (
    <section
      aria-label="Financing checkpoints"
      className="rounded-al-md border border-al-border bg-al-bg p-4"
      data-testid="financing-checkpoints"
    >
      <ol className="space-y-3">
        <li className="flex gap-3">
          <Lock
            size={16}
            aria-hidden="true"
            className={stage === "locked" ? "mt-0.5 shrink-0 text-al-success" : "mt-0.5 shrink-0 text-al-text-subtle"}
          />
          <div>
            <p className="text-[13px] font-semibold text-al-text">
              Terms locked{stage === "locked" ? " — done" : ""}
            </p>
            <p className="text-[13px] leading-relaxed text-al-text-muted">
              Before your contract is prepared. The path is chosen and the terms are known well
              enough to write a contract. Recorded by our team against the lender&apos;s evidence.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-al-text-subtle" />
          <div>
            <p className="text-[13px] font-semibold text-al-text">Financing completed</p>
            <p className="text-[13px] leading-relaxed text-al-text-muted">
              After signing, before the vehicle is released. The lender has approved the final
              contract and committed to fund — or, for cash, the dealership confirms the money is
              in. Your car does not move until this one is met.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}

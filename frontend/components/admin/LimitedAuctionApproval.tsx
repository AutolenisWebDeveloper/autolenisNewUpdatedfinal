"use client";

// §6c's audited limited-auction approval, as a control — S6-24 and S6-27.
//
// §6c: "3–4 | Limited auction, only with audited Operations approval", then the four conditions:
// "A limited auction requires a completely searched permitted radius, documented scarcity or
// urgency, disclosure of the field size to the buyer, and an audited approval."
//
// THE ROUTE ENFORCES ALL FOUR; THIS FORM DOES NOT PRE-AUTHORISE ANYTHING. Everything below is
// re-checked server-side, and the refusals are HTTP 409s with specific codes. What the form adds
// is that an operator can see WHICH condition will refuse before they write a justification and
// lose it — a 409 after typing three sentences is a worse experience than a disabled button that
// says why.
//
// THE REASON IS THE DOCUMENTATION, AND IT IS NOT OPTIONAL. §6c's "documented scarcity or
// urgency" is satisfied by the text an operator types here, which is stored on the audit row and
// on the case's transition reason. So it is a textarea and not a dropdown of canned reasons: a
// later reviewer asking "why did we run a 3-dealer auction for this buyer" needs the answer
// somebody actually had, not a category.
//
// IT DOES NOT LAUNCH ANYTHING. Approval moves the case to READY_TO_LAUNCH; the §7 readiness
// checklist still has to pass, which is why `DEALER_COUNT` in `launch-readiness.service.ts`
// tests `limitedAuctionApprovedAt` rather than trusting a status. The copy says so, because an
// operator who believes they have launched an auction stops watching it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";
import { CARD, EYEBROW } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

interface Props {
  caseId: string;
  fieldSize: number;
  minLimited: number;
  minAuto: number;
  /** True while §6c condition 1 is unmet — the route refuses in this state. */
  furtherBandSearchable: boolean;
  alreadyApprovedAt: string | null;
}

export default function LimitedAuctionApproval({
  caseId,
  fieldSize,
  minLimited,
  minAuto,
  furtherBandSearchable,
  alreadyApprovedAt,
}: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(alreadyApprovedAt !== null);

  const fieldInWindow = fieldSize >= minLimited && fieldSize < minAuto;
  // Mirrors the route's refusals, in the route's own order, so the reason shown is the reason
  // the server would give.
  const blocked = furtherBandSearchable
    ? `Band is not exhausted: a wider band is still searchable. §6c requires a completely searched permitted radius.`
    : !fieldInWindow
      ? `A limited auction covers ${minLimited}–${minAuto - 1} invitation-ready rooftops. This case has ${fieldSize}.`
      : null;

  async function approve() {
    if (!reason.trim()) {
      setError("State the scarcity or urgency. It is stored on the audit record and is §6c's documentation.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/admin/sourcing/${caseId}/limited-auction`, { reason: reason.trim() });
      setApproved(true);
      router.refresh();
    } catch (err) {
      // The server's specific refusal — RADIUS_NOT_EXHAUSTED, DISCLOSURE_MISSING, INVALID_STATE
      // each name a different next action, and collapsing them into one message would make the
      // operator guess.
      setError(apiErrorMessage(err, "The approval was not recorded."));
    } finally {
      setSaving(false);
    }
  }

  if (approved) {
    return (
      <section
        className={cn(CARD, "mt-5 border-emerald-200 p-5")}
        data-testid="limited-auction-approved"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <Check size={15} aria-hidden="true" /> Limited auction approved
        </p>
        <p className="mt-1 text-sm text-slate-600">
          The case is READY_TO_LAUNCH. Launch still requires every §7 readiness item above to
          pass — approval clears the field-size item and nothing else.
        </p>
      </section>
    );
  }

  return (
    <section className={cn(CARD, "mt-5 p-5")} data-testid="limited-auction-approval">
      <p className={EYEBROW}>Limited auction — §6c approval</p>
      <p className="mt-2 text-sm text-slate-700">
        This case has <strong className="font-semibold">{fieldSize}</strong> invitation-ready
        rooftops, below the {minAuto} that launch automatically. §6c allows a limited auction with
        audited Operations approval.
      </p>

      {/* The four conditions, shown as conditions rather than as prose, because three of them are
          refusals and the operator needs to know which one is in the way. */}
      <ul className="mt-4 space-y-2 text-sm" data-testid="limited-auction-conditions">
        <li className="flex items-start gap-2" data-condition="radius" data-met={!furtherBandSearchable}>
          {furtherBandSearchable ? (
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          ) : (
            <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          )}
          <span className={furtherBandSearchable ? "text-slate-900" : "text-slate-600"}>
            The permitted radius is completely searched
          </span>
        </li>
        <li className="flex items-start gap-2" data-condition="window" data-met={fieldInWindow}>
          {fieldInWindow ? (
            <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          <span className={fieldInWindow ? "text-slate-600" : "text-slate-900"}>
            The field is {minLimited}–{minAuto - 1} rooftops
          </span>
        </li>
        <li className="flex items-start gap-2 text-slate-600" data-condition="disclosure">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            The buyer has been told the field size — verified server-side against the queued
            disclosure, and refused if it is absent
          </span>
        </li>
        <li className="flex items-start gap-2 text-slate-600" data-condition="audit">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>Your approval and the reason below are written to the audit log</span>
        </li>
      </ul>

      {blocked && (
        <p
          className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="limited-auction-blocked"
        >
          {blocked}
        </p>
      )}

      <div className="mt-4">
        <label htmlFor="limited-reason" className="text-sm font-semibold text-slate-900">
          Documented scarcity or urgency
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          What a reviewer will read when they ask why this buyer went into a {fieldSize}-dealer
          auction.
        </p>
        <textarea
          id="limited-reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          disabled={blocked !== null}
          data-testid="limited-auction-reason"
          className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-900 focus:border-al-primary focus:outline-none focus:ring-2 focus:ring-al-primary/20 disabled:bg-slate-50"
          placeholder="e.g. Only three rooftops within 250 miles carry this trim; the buyer's financing approval expires in six days."
        />
      </div>

      {error && (
        <p
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
          role="alert"
          data-testid="limited-auction-error"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={approve}
        disabled={saving || blocked !== null || !reason.trim()}
        data-testid="limited-auction-approve"
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-al-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
        {saving ? "Recording…" : "Approve a limited auction"}
      </button>
      <p className="mt-2 text-xs text-slate-400">
        This does not launch the auction. It clears the field-size item; every other §7 readiness
        item still has to pass.
      </p>
    </section>
  );
}

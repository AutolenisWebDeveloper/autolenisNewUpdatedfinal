"use client";
// components/buyer/PickupPossessionForm.tsx — §Stage 19, the buyer confirms possession.
//
// THE SCREEN THAT DID NOT EXIST. Before Phase 9 a dealer's scan advanced the Deal straight to
// COMPLETED and there was no buyer-side confirmation anywhere in the product — no route, no
// field, and no form. §Stage 19 is explicit that this is the wrong shape: "A dealer release with
// no buyer confirmation reminds the buyer — the Deal never completes automatically on the
// dealer's word alone." The route landed first; without this it was unreachable.
//
// WHAT IT ASKS FOR IS §STAGE 19'S LIST, and no more: vehicle received; VIN match; odometer;
// condition as delivered; keys and promised accessories received. It is deliberately short. This
// is filled in on a phone, standing next to a car, by somebody who wants to drive away.
//
// TWO ANSWERS ARE NOT FAILURES OF THE FORM AND MUST NOT LOOK LIKE ONE.
//
//   "No, the VIN does not match" and "something is wrong" are TRUTHFUL answers, and the product
//   has to make them as easy to give as the happy path. A form that only works when everything
//   is fine teaches people to say everything is fine. §Stage 19 makes a material discrepancy
//   BLOCK completion and open an Operations case — so reporting one is a successful outcome of
//   this screen, and the copy says so rather than showing an error.
//
//   §Stage 20 refusing on an outstanding precondition is also not a failure of this form. The
//   buyer's confirmation is already recorded by then; what is missing is somebody else's
//   paperwork. So that response is rendered as a checklist of what is outstanding and who owns
//   it — the same rows the rest of the journey uses — not as "could not complete".

import { useState } from "react";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

interface OutstandingRow {
  key: string;
  checkpoint: string;
  responsibleParty: string;
  detail: string;
}

const PARTY_LABEL: Record<string, string> = {
  FINANCE: "AutoLenis Finance",
  DEALERSHIP: "The dealership",
  BUYER: "You",
  OPERATIONS: "AutoLenis Operations",
};

type Outcome =
  | { kind: "complete" }
  | { kind: "discrepancy"; message: string }
  | { kind: "blocked"; message: string; outstanding: OutstandingRow[] }
  | { kind: "error"; message: string };

export default function PickupPossessionForm({ dealId, vin }: { dealId: string; vin: string | null }) {
  const [vehicleReceived, setVehicleReceived] = useState(false);
  const [vinMatch, setVinMatch] = useState(false);
  const [keysReceived, setKeysReceived] = useState(false);
  const [odometer, setOdometer] = useState("");
  const [condition, setCondition] = useState("");
  const [problem, setProblem] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit() {
    setSubmitting(true);
    setOutcome(null);
    try {
      await api.post(`/api/buyer/pickup/${dealId}/possession`, {
        vehicleReceived,
        vinMatch,
        keysAndAccessoriesReceived: keysReceived,
        ...(odometer.trim() ? { odometerAtPossession: Number(odometer.trim()) } : {}),
        ...(condition.trim() ? { conditionAsDelivered: condition.trim() } : {}),
        // A problem reported here is MATERIAL by definition — the buyer chose to raise it at
        // the moment of taking the car. A non-material note belongs in messages, not in the
        // field that blocks a completion.
        ...(problem.trim() ? { discrepancy: { material: true, note: problem.trim() } } : {}),
      });
      setOutcome({ kind: "complete" });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; details?: { outstanding?: OutstandingRow[] } };
      if (e.code === "DISCREPANCY_REPORTED") {
        setOutcome({ kind: "discrepancy", message: e.message ?? "" });
      } else if (e.code === "COMPLETION_BLOCKED") {
        setOutcome({ kind: "blocked", message: e.message ?? "", outstanding: e.details?.outstanding ?? [] });
      } else {
        setOutcome({ kind: "error", message: e.message ?? "Something went wrong. Please try again." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome?.kind === "complete") {
    return (
      <div className="bg-al-surface border border-al-border rounded-al-lg p-6 text-center" data-testid="possession-complete">
        <CheckCircle2 size={40} className="text-al-success mx-auto mb-3" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-al-text mb-1">That&apos;s everything</h2>
        <p className="text-sm text-al-text-muted">
          Your deal is complete. We&apos;ve emailed your executed contract and receipt, and we&apos;ll keep
          tracking anything the dealership still owes you — the title, your registration, and any
          promised work.
        </p>
      </div>
    );
  }

  if (outcome?.kind === "discrepancy") {
    return (
      <div className="bg-al-surface border border-al-border rounded-al-lg p-6" data-testid="possession-discrepancy">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-al-warning mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-al-text mb-1">We&apos;ve got it</h2>
            <p className="text-sm text-al-text-muted">{outcome.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-al-surface border border-al-border rounded-al-lg p-6" data-testid="possession-form">
      <h2 className="font-display text-lg font-semibold text-al-text mb-1">Confirm you have your vehicle</h2>
      <p className="text-sm text-al-text-muted mb-5">
        The dealership recorded that they released it to you. Your deal isn&apos;t complete until you
        confirm — take a moment to check these before you do.
      </p>

      <fieldset className="space-y-3 mb-5">
        <legend className="sr-only">What you received</legend>
        <label className="flex items-start gap-3 text-sm text-al-text cursor-pointer">
          <input
            type="checkbox"
            checked={vehicleReceived}
            onChange={(e) => setVehicleReceived(e.target.checked)}
            className="mt-0.5 h-4 w-4"
            data-testid="possession-vehicle-received"
          />
          <span>I have the vehicle.</span>
        </label>
        <label className="flex items-start gap-3 text-sm text-al-text cursor-pointer">
          <input
            type="checkbox"
            checked={vinMatch}
            onChange={(e) => setVinMatch(e.target.checked)}
            className="mt-0.5 h-4 w-4"
            data-testid="possession-vin-match"
          />
          <span>
            The VIN on the car matches my contract
            {vin && <span className="block text-xs text-al-text-muted font-mono mt-0.5">{vin}</span>}
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-al-text cursor-pointer">
          <input
            type="checkbox"
            checked={keysReceived}
            onChange={(e) => setKeysReceived(e.target.checked)}
            className="mt-0.5 h-4 w-4"
            data-testid="possession-keys-received"
          />
          <span>I have all the keys and everything that was promised with the car.</span>
        </label>
      </fieldset>

      <div className="space-y-4 mb-5">
        <div>
          <label htmlFor="odometer" className="block text-sm font-medium text-al-text mb-1">
            Mileage on the odometer
          </label>
          <input
            id="odometer"
            type="number"
            inputMode="numeric"
            min={0}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            className="w-full border border-al-border rounded-al px-3 py-2 text-sm"
            placeholder="e.g. 12480"
            data-testid="possession-odometer"
          />
        </div>
        <div>
          <label htmlFor="condition" className="block text-sm font-medium text-al-text mb-1">
            How was the car when you got it?
          </label>
          <textarea
            id="condition"
            rows={2}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="w-full border border-al-border rounded-al px-3 py-2 text-sm"
            placeholder="Clean, as described — or anything you noticed."
            data-testid="possession-condition"
          />
        </div>
        <div>
          <label htmlFor="problem" className="block text-sm font-medium text-al-text mb-1">
            Is something wrong? <span className="font-normal text-al-text-muted">(optional)</span>
          </label>
          <textarea
            id="problem"
            rows={2}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            className="w-full border border-al-border rounded-al px-3 py-2 text-sm"
            placeholder="Tell us and we'll open a case with the dealership. Your deal stays open until it's sorted."
            data-testid="possession-problem"
          />
        </div>
      </div>

      {outcome?.kind === "blocked" && (
        <div className="mb-5 border border-amber-200 bg-amber-50 rounded-al p-4" data-testid="possession-blocked">
          <p className="text-sm text-slate-800 mb-3">
            We&apos;ve recorded your confirmation. Before the deal can close, these are still
            outstanding:
          </p>
          <ul className="space-y-2">
            {outcome.outstanding.map((row) => (
              <li key={row.key} className="text-xs" data-testid={`possession-outstanding-${row.key}`}>
                <span className="font-medium text-slate-800">{row.checkpoint}</span>
                <span className="text-slate-600"> — {row.detail}</span>
                <span className="block text-slate-500 mt-0.5">
                  Waiting on:{" "}
                  <span className={row.responsibleParty === "BUYER" ? "font-semibold text-amber-700" : "font-semibold text-slate-600"}>
                    {PARTY_LABEL[row.responsibleParty] ?? row.responsibleParty}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome?.kind === "error" && (
        <p className="text-sm text-al-danger mb-4" role="alert" data-testid="possession-error">
          {outcome.message}
        </p>
      )}

      <Button onClick={submit} disabled={submitting} data-testid="possession-submit">
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin mr-2" aria-hidden="true" /> Sending
          </>
        ) : problem.trim() ? (
          "Report a problem"
        ) : (
          "Confirm I have my vehicle"
        )}
      </Button>
      {/* Said BEFORE they press. `vehicleReceived: false` is refused by the route, and a buyer
          who has just ticked nothing deserves to know why rather than to be told after. */}
      {!vehicleReceived && !problem.trim() && (
        <p className="text-xs text-al-text-subtle mt-2">
          Tick &ldquo;I have the vehicle&rdquo; to confirm — or tell us what&apos;s wrong and we&apos;ll open a case.
        </p>
      )}
    </div>
  );
}

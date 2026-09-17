"use client";
// components/dealer/PickupActionsClient.tsx — §Stage 18, the dealership records the handover.
//
// THE DEFECT THIS REPLACES, FOUND BY THE PHASE 9 ADVERSARIAL REVIEW AND CONFIRMED. This form used
// to POST `{ qrToken }` and nothing else. Phase 9 made §Stage 18's identity check a hard
// PRECONDITION — "an identity mismatch" is the first thing the document lists as blocking a
// handover — so `identityVerified` arriving `undefined` read as `false`, and EVERY real scan was
// refused with `identity_unverified`, raised `ID_MISMATCH_AT_HANDOVER` against a buyer and a
// dealership who had done nothing wrong, and then told the dealership "This QR code has already
// been scanned." because the handler collapsed every 409 into that one sentence.
//
// The vehicle would not have been released, the dealership would have been told a falsehood about
// why, and the OPEN queue item would have made §Stage 20's fourteenth precondition false — so the
// deal could never complete until Operations closed the case by hand. Not an edge case: 100% of
// dealer handovers. The route's contract changed and its only caller was left behind.
//
// WHAT §STAGE 18 SAYS IS "RECORDED" — and the route has always accepted all of it; nothing asked
// the dealership for it. Identity verified against the contract; the odometer at release; the
// condition at release; how the funds were collected; and whether a trade was received. Each one
// is evidence about a vehicle that is about to leave the lot, and each one is a §Stage 20
// precondition or a §Stage 21 obligation's starting fact.
//
// AND THE SUCCESS COPY WAS WRONG IN THE SAME DIRECTION. It said "deal marked complete". The scan
// now records HANDOVER only — §Stage 19 is explicit that "the Deal never completes automatically
// on the dealer's word alone" — so it says what actually happened and what happens next.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  dealId: string;
}

/**
 * Every refusal the route can return, in its own words.
 *
 * ONE MESSAGE PER CODE, because the collapsed version is what made the identity defect
 * undiagnosable from the counter: a dealership told "already scanned" checks whether somebody
 * else scanned it, which is the one thing that had not happened.
 */
const REFUSALS: Record<string, string> = {
  IDENTITY_NOT_VERIFIED:
    "Confirm the buyer's identity against the contract before releasing the vehicle.",
  ALREADY_SCANNED: "This pickup code has already been used.",
  INVALID_TOKEN: "This pickup code is not valid or has expired. Ask the buyer to show a fresh one.",
  NOT_READY_FOR_PICKUP: "This deal is not at a scheduled handover yet.",
  INSURANCE_REQUIRED:
    "The buyer's insurance is not verified. The vehicle cannot be released until it is.",
  RELEASE_NOT_CLEARED:
    "AutoLenis has not cleared this vehicle for release yet — funding or the executed contract is outstanding.",
  VALIDATION_ERROR: "Enter the buyer's pickup code.",
  UNAUTHORIZED: "Your session has expired. Sign in again.",
};

export default function PickupActionsClient({ dealId }: Props) {
  const router = useRouter();
  const [qrToken, setQrToken] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);
  const [odometer, setOdometer] = useState("");
  const [condition, setCondition] = useState("");
  const [fundsMethod, setFundsMethod] = useState("");
  const [tradeReceived, setTradeReceived] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!qrToken.trim() || !identityVerified) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/pickup/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrToken: qrToken.trim(),
          identityVerified,
          ...(odometer.trim() ? { odometerAtRelease: Number(odometer.trim()) } : {}),
          ...(condition.trim() ? { conditionAtRelease: condition.trim() } : {}),
          ...(fundsMethod.trim() ? { fundsCollectedMethod: fundsMethod.trim() } : {}),
          tradeReceived,
        }),
      });

      if (!res.ok) {
        // The CODE, not the status. Six distinct refusals share 409, and which one it is decides
        // what the person at the counter should do next.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        const code = body?.error?.code ?? "";
        setError(REFUSALS[code] ?? body?.error?.message ?? "Scan failed. Please try again.");
        return;
      }

      setSuccess(true);
      setQrToken("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  if (success) {
    return (
      <div
        className="flex items-start gap-2 bg-al-success-subtle border border-al-success/30 rounded-al px-4 py-3 text-sm text-al-success-fg"
        role="status"
        aria-live="polite"
        data-testid={`scan-success-${dealId}`}
      >
        <CheckCircle2 size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          <strong>Handover recorded.</strong> The buyer has been asked to confirm they have the
          vehicle — the deal completes when they do.
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleScan} className="space-y-3" data-testid={`pickup-form-${dealId}`}>
      {error && (
        <p className="text-sm text-al-danger" role="alert" data-testid={`scan-error-${dealId}`}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Input
          type="text"
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
          placeholder="Buyer's pickup code..."
          className="flex-1"
          aria-label="Buyer's pickup code"
          data-testid={`qr-token-input-${dealId}`}
        />
      </div>

      {/* THE PRECONDITION, not a field. §Stage 18 blocks a handover on an identity mismatch, so
          this gates the button rather than travelling as one more optional value. */}
      <label className="flex items-start gap-2 text-sm text-al-text cursor-pointer min-h-11 py-1.5">
        <input
          type="checkbox"
          checked={identityVerified}
          onChange={(e) => setIdentityVerified(e.target.checked)}
          className="mt-0.5 h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
          data-testid={`identity-verified-${dealId}`}
        />
        <span>
          I have checked the buyer&apos;s photo ID — and any co-buyer&apos;s — against the contract.
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-al-text-muted">
          Odometer at release
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            placeholder="e.g. 12480"
            className="mt-1"
            data-testid={`odometer-${dealId}`}
          />
        </label>
        <label className="text-xs text-al-text-muted">
          Funds collected by
          <Input
            type="text"
            value={fundsMethod}
            onChange={(e) => setFundsMethod(e.target.value)}
            placeholder="e.g. cashier's check"
            className="mt-1"
            data-testid={`funds-method-${dealId}`}
          />
        </label>
      </div>

      <label className="block text-xs text-al-text-muted">
        Condition at release
        <Input
          type="text"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="Anything noted before the vehicle left"
          className="mt-1"
          data-testid={`condition-${dealId}`}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-al-text cursor-pointer min-h-11">
        <input
          type="checkbox"
          checked={tradeReceived}
          onChange={(e) => setTradeReceived(e.target.checked)}
          className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
          data-testid={`trade-received-${dealId}`}
        />
        <span>We took the buyer&apos;s trade-in, with title and keys.</span>
      </label>

      <Button
        type="submit"
        disabled={scanning || !qrToken.trim() || !identityVerified}
        data-testid={`scan-qr-${dealId}`}
      >
        {scanning ? "Recording..." : "Record handover"}
      </Button>
      {!identityVerified && (
        <p className="flex items-start gap-1.5 text-xs text-al-text-subtle">
          <Clock size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
          Identity has to be confirmed before a vehicle is released.
        </p>
      )}
    </form>
  );
}

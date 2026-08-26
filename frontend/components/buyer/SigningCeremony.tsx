"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { getActiveConsentPolicy, type ConsentAckKey } from "@/lib/services/esign/consent-policy";

interface Presentation {
  status: string | null;
  dealStatus: string;
  contractViewUrl: string | null;
  signable: boolean;
}

type Phase = "loading" | "review" | "completed" | "unavailable" | "error";

// In-app electronic-signature ceremony. The buyer reviews the actual approved
// contract, affirmatively consents to electronic signing, adopts their signature
// by typing their legal name, and submits. All authoritative evidence (identity,
// IP, user-agent, timestamps, document hash) is captured server-side — this
// component only collects the consent action and the adopted name.
export default function SigningCeremony({ dealId }: { dealId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Presentation | null>(null);
  // The four required acknowledgments — NONE preselected. "Continue to Sign"
  // stays disabled until every one is affirmatively checked (server re-validates).
  const consentPolicy = useMemo(() => getActiveConsentPolicy(), []);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAcknowledged = consentPolicy.acknowledgments.every((a) => acks[a.key] === true);
  const toggleAck = (key: ConsentAckKey, checked: boolean) =>
    setAcks((prev) => ({ ...prev, [key]: checked }));

  const load = useCallback(async () => {
    try {
      // Read current state; begin (prepare) signing if the contract is approved
      // but no live signing session exists yet.
      let res = await fetch(`/api/buyer/esign/${dealId}`, { cache: "no-store" });
      let json = await res.json();
      let p: Presentation = json?.data ?? json;

      if (!p?.signable && p?.status !== "COMPLETED" && (p?.dealStatus === "CONTRACT_APPROVED" || p?.dealStatus === "SIGNING_PENDING")) {
        const begin = await fetch(`/api/buyer/esign/${dealId}`, { method: "POST" });
        if (begin.ok) {
          res = await fetch(`/api/buyer/esign/${dealId}`, { cache: "no-store" });
          json = await res.json();
          p = json?.data ?? json;
        }
      }

      setData(p);
      if (p?.status === "COMPLETED") setPhase("completed");
      else if (p?.signable && p?.contractViewUrl) setPhase("review");
      else setPhase("unavailable");
    } catch {
      setPhase("error");
    }
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/esign/${dealId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledgments: consentPolicy.acknowledgments.map((a) => ({ key: a.key, accepted: acks[a.key] === true })),
          signatureText: typedName.trim(),
        }),
      });
      const json = await res.json();
      if (res.ok && (json?.data?.status === "COMPLETED" || json?.status === "COMPLETED")) {
        setPhase("completed");
        return;
      }
      const code = json?.error?.code ?? json?.code;
      if (code === "DOCUMENT_CHANGED") {
        setError("The contract was updated since you opened it. We've refreshed your signing session — please review the current contract and sign again.");
        await load();
      } else {
        setError(json?.error?.message ?? "We couldn't record your signature. Please try again.");
      }
    } catch {
      setError("We couldn't record your signature. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-12" role="status" aria-live="polite">
        <Loader2 size={18} className="animate-spin" /> Preparing your contract…
      </div>
    );
  }

  if (phase === "completed") {
    return (
      <div className="text-center" data-testid="esign-completed">
        <CheckCircle2 size={40} className="text-green-500 mx-auto mb-4" aria-hidden="true" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Your contract is signed</h2>
        <p className="text-slate-500 text-sm mb-6">Thank you. Your signature has been recorded. You&apos;re almost at the finish line.</p>
        <div className="flex items-center justify-center gap-3">
          <Button href="/buyer/pickup" data-testid="goto-pickup-btn">Schedule Pickup</Button>
          <a href={`/api/buyer/esign/${dealId}/certificate`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-al-primary underline underline-offset-2">
            View signature certificate
          </a>
        </div>
      </div>
    );
  }

  if (phase === "unavailable" || phase === "error") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center" data-testid="esign-pending">
        <p className="text-slate-600 text-sm">
          {phase === "error"
            ? "We couldn't load your signing session. Please refresh the page."
            : "Your contract isn't ready to sign yet. You'll be notified as soon as it's available."}
        </p>
      </div>
    );
  }

  // phase === "review"
  return (
    <div data-testid="esign-review">
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <FileText size={20} className="text-al-primary" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold text-slate-900 text-sm">Review your purchase contract</p>
          <p className="text-xs text-slate-500 mt-0.5">Read the full contract below before signing.</p>
        </div>
        <Badge variant="amber">Ready to sign</Badge>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden mb-3 bg-slate-50">
        <iframe
          src={data?.contractViewUrl ?? undefined}
          title="Your purchase contract"
          className="w-full h-[52vh] min-h-[320px]"
          data-testid="esign-contract-frame"
        />
      </div>
      <p className="text-xs text-slate-500 mb-6">
        Trouble viewing?{" "}
        <a href={data?.contractViewUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="text-al-primary underline underline-offset-2">
          Open the contract in a new tab
        </a>
        .
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-2 mb-4">
          <ShieldCheck size={18} className="text-al-primary mt-0.5" aria-hidden="true" />
          <p className="text-xs text-slate-600">
            Please read and confirm each acknowledgment below before signing. The exact contract you sign is recorded
            for your protection.
          </p>
        </div>

        <fieldset className="mb-4" data-testid="esign-consents">
          <legend className="text-sm font-medium text-slate-700 mb-2">Signing acknowledgments</legend>
          <div className="space-y-3">
            {consentPolicy.acknowledgments.map((ack) => (
              <label key={ack.key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acks[ack.key] === true}
                  onChange={(e) => toggleAck(ack.key, e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-al-primary focus:ring-al-primary"
                  data-testid={`esign-consent-${ack.key}`}
                />
                <span className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{ack.title}. </span>
                  {ack.text}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="esign-adopt" className="block text-sm font-medium text-slate-700 mb-1">
          Type your full legal name to adopt your signature
        </label>
        <input
          id="esign-adopt"
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="e.g. Jordan A. Rivera"
          autoComplete="name"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-al-primary focus:ring-1 focus:ring-al-primary mb-4"
          data-testid="esign-adopt-input"
        />

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <Button
          onClick={submit}
          disabled={!allAcknowledged || typedName.trim().length < 2 || submitting}
          className="w-full"
          data-testid="esign-submit"
        >
          {submitting ? "Recording your signature…" : "Continue to Sign"}
        </Button>
      </div>
    </div>
  );
}

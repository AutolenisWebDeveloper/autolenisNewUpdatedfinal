"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { getActiveConsentPolicy, type ConsentAckKey } from "@/lib/services/esign/consent-policy";

/**
 * §13-D30's co-buyer ceremony.
 *
 * Deliberately NOT a variant of SigningCeremony. That component loads state from
 * `/api/buyer/esign/[dealId]`, which is Supabase-authenticated — the co-buyer has no session
 * to make that call with, which is the whole reason this surface exists. What the two DO share
 * is the thing that must not diverge: the consent policy, imported from the same module, so
 * the four acknowledgments and their exact text are identical for both signers and the server
 * validates both against the same version.
 *
 * CONDITION 5 — the co-buyer's own consent snapshot, own adopted name. IP and user agent are
 * taken server-side from the request; the client cannot author its own audit trail.
 */
export default function InvitedSigningCeremony({
  token,
  coBuyerName,
  primaryBuyerFirstName,
  vehicle,
  vin,
  signingClosesAt,
}: {
  token: string;
  coBuyerName: string;
  primaryBuyerFirstName: string | null;
  vehicle: string;
  vin: string | null;
  signingClosesAt: string | null;
}) {
  const consentPolicy = useMemo(() => getActiveConsentPolicy(), []);
  // NONE preselected — a pre-ticked consent box is not consent. The server re-validates every
  // one of them regardless of what this component sends.
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  const allAcknowledged = consentPolicy.acknowledgments.every((a) => acks[a.key] === true);
  const canSign = allAcknowledged && typedName.trim().length > 1 && !submitting;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/esign/invited/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledgments: consentPolicy.acknowledgments.map((a) => ({ key: a.key, accepted: acks[a.key] === true })),
          signatureText: typedName.trim(),
        }),
      });
      if (res.ok) { setSigned(true); return; }
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(payload?.error?.message ?? "This contract could not be signed right now.");
    } catch {
      setError("We couldn't reach AutoLenis. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (signed) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 text-center" data-testid="invited-signer-signed">
        <CheckCircle2 size={32} className="text-green-600 mx-auto mb-4" aria-hidden="true" />
        <h1 className="text-lg font-bold text-slate-900 mb-2">Signed — thank you</h1>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Your signature is recorded. We&apos;ll email you a copy of the fully executed agreement
          once the dealership has countersigned it. Nothing else is needed from you.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-8" data-testid="invited-signer-ceremony">
      <h1 className="text-xl font-bold text-slate-900 mb-1">Sign your vehicle contract</h1>
      <p className="text-sm text-slate-600 mb-5">
        {primaryBuyerFirstName ? `${primaryBuyerFirstName} has` : "The buyer has"} named you as a
        required signer on the purchase of the {vehicle}
        {vin ? <> (VIN <span className="font-mono text-xs">{vin}</span>)</> : null}. Your signature is
        needed before the vehicle can be released.
      </p>

      {signingClosesAt && (
        <p className="text-xs text-slate-500 mb-5">
          This signing link closes on{" "}
          <span className="font-semibold text-slate-700">
            {new Date(signingClosesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
          .
        </p>
      )}

      <fieldset className="space-y-3 mb-6">
        <legend className="sr-only">Required electronic signature acknowledgments</legend>
        {consentPolicy.acknowledgments.map((a) => (
          <label
            key={a.key}
            htmlFor={`ack-${a.key}`}
            className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50"
          >
            <input
              id={`ack-${a.key}`}
              type="checkbox"
              className="mt-1 h-4 w-4 flex-shrink-0 accent-al-primary"
              checked={acks[a.key] === true}
              onChange={(e) => setAcks((p) => ({ ...p, [a.key as ConsentAckKey]: e.target.checked }))}
              data-testid={`invited-ack-${a.key}`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">{a.title}</span>
              <span className="block text-xs text-slate-600 mt-0.5">{a.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label htmlFor="invited-typed-name" className="block text-sm font-medium text-slate-800 mb-1">
        Type your full legal name to sign
      </label>
      <input
        id="invited-typed-name"
        type="text"
        value={typedName}
        onChange={(e) => setTypedName(e.target.value)}
        placeholder={coBuyerName || "Your full legal name"}
        autoComplete="name"
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-al-primary"
        data-testid="invited-typed-name"
      />
      <p className="text-xs text-slate-500 mb-5">
        Typing your name here has the same legal effect as signing on paper.
      </p>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4" role="alert" data-testid="invited-signer-error">
          {error}
        </p>
      )}

      <Button onClick={submit} disabled={!canSign} data-testid="invited-sign-btn" className="w-full sm:w-auto">
        {submitting ? "Signing…" : "Sign contract"}
      </Button>

      <p className="flex items-start gap-2 text-xs text-slate-500 mt-5 pt-4 border-t border-slate-100">
        <ShieldCheck size={14} className="text-al-primary mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>
          AutoLenis does not provide legal advice and does not represent any party to this
          agreement. You may consult an independent attorney before signing.
        </span>
      </p>
    </div>
  );
}

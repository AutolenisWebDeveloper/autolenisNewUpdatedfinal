"use client";
// components/buyer/PickupReleaseCode.tsx — the buyer's pickup code, revealed on demand.
//
// REPLACES a stored PNG. Until 2026-09-16 /buyer/pickup rendered `pickup.qrCodeImage` straight
// from the database on every load. That image was `QRCode.toDataURL(rawToken)`, so it decoded
// back to the credential: the column WAS the code. Migration 20261201000000 clears it and nothing
// writes it any more, so there is no image left to render — the raw token exists only at the
// instant it is minted.
//
// THE CAPABILITY MOVED, IT DID NOT GO. The buyer still shows a code at the lot. It is now
// produced when they ask for it, which is also the only moment it can be produced. The trade the
// screen has to be honest about: revealing RETIRES the previous code, so a buyer who reveals on
// their laptop and then drives to the dealership with their phone needs to reveal again on the
// phone. That is said before they press, not after it has cost them.

import { useState } from "react";
import { QrCode, Loader2, RefreshCw } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

interface Props {
  dealId: string;
}

interface RevealedCode {
  releaseCodeImage: string;
  expiresAt: string;
}

export default function PickupReleaseCode({ dealId }: Props) {
  const [code, setCode] = useState<RevealedCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      // POST, not GET: this mints. See the route for why that distinction is load-bearing.
      const result = await api.post<RevealedCode>(`/api/buyer/pickup/${dealId}/release-code`);
      setCode(result);
    } catch (err) {
      setError(apiErrorMessage(err, "We couldn't produce your pickup code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const expiresLabel = code
    ? new Date(code.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div
      className="text-center bg-al-surface border border-al-border rounded-al-lg p-8 mb-6"
      data-testid="pickup-release-code"
    >
      <QrCode size={32} className="text-al-primary mx-auto mb-3" />

      {code ? (
        <>
          <p className="text-sm text-al-text-muted mb-4">Present this code at the lot</p>
          {/* The image is held in this component's state for as long as the page is open and is
              never written anywhere. Reloading the page requires revealing again — which is the
              point, not a rough edge. */}
          <img src={code.releaseCodeImage} alt="Pickup code" className="mx-auto max-w-[200px]" data-testid="pickup-release-code-image" />
          {expiresLabel && (
            <p className="text-xs font-medium mt-2 text-al-success" data-testid="pickup-release-code-expiry">
              ✓ Valid until {expiresLabel}
            </p>
          )}
          <button
            onClick={reveal}
            disabled={loading}
            data-testid="pickup-release-code-refresh"
            className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-al-primary hover:text-al-primary-hover transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Show a new code
          </button>
          <p className="text-xs text-al-text-subtle mt-2">
            A new code replaces this one — only the most recent code works.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-al-text-muted mb-1">Your pickup code is shown when you ask for it</p>
          <p className="text-xs text-al-text-subtle mb-4">
            Show it on the device you&apos;ll have at the dealership — a new code replaces any you were shown before.
          </p>
          <button
            onClick={reveal}
            disabled={loading}
            data-testid="pickup-release-code-reveal"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-al-md bg-al-primary text-white text-sm font-semibold hover:bg-al-primary-hover transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
            {loading ? "Preparing…" : "Show my pickup code"}
          </button>
        </>
      )}

      {error && (
        <div className="mt-3" data-testid="pickup-release-code-error">
          <p className="text-xs font-medium text-al-danger">{error}</p>
          {/* THE FALLBACK MATTERS MORE THAN IT DID. The code used to be rendered into the page
              server-side, so a buyer standing on a dealership lot with one bar of signal still
              had it. It now needs a live round trip, which makes exactly that person more likely
              to be stuck — so the escape hatch that came off the stored image belongs here, where
              the failure actually happens. */}
          <p className="text-xs text-al-text-muted mt-2">
            You don&apos;t need this code to collect your vehicle — the dealership can complete the
            handover with our team directly.
          </p>
          <a
            href="/buyer/messages"
            data-testid="pickup-release-code-support"
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-al-primary hover:text-al-primary-hover transition-colors"
          >
            Message support →
          </a>
        </div>
      )}
    </div>
  );
}

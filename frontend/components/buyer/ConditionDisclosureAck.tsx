"use client";

// §Stage 10 — "The buyer acknowledges the condition disclosure before the transaction proceeds to
// recap. This is a single explicit acknowledgment, not a stack of screens."
//
// ONE SCREEN, ONE ACTION, and the document says so in as many words. The artefacts — condition
// report, history report, current photographs — are LINKED rather than embedded, because a PDF
// viewer inside an acknowledgement flow is the "stack of screens" this rule exists to prevent, and
// because a buyer on a phone opens a report in their own reader.
//
// THE BUTTON IS DISABLED UNTIL THE BOX IS TICKED, and the box says what is being acknowledged
// rather than "I agree". An acknowledgement whose text a buyer cannot restate is not one.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ShieldCheck } from "lucide-react";

export function ConditionDisclosureAck({
  dealId,
  artifactUrls,
}: {
  dealId: string;
  artifactUrls: string[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/deal/${dealId}/reaffirmation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ACKNOWLEDGE_DISCLOSURE" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "We could not save your acknowledgement. Please try again.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not save your acknowledgement. Please try again.");
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="disclosure-heading"
      className="rounded-al-lg border border-al-border bg-al-surface"
      data-testid="condition-disclosure"
    >
      <header className="border-b border-al-border px-5 py-4 sm:px-6">
        <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-al-text-subtle">
          <ShieldCheck size={14} aria-hidden="true" />
          One last look before your final numbers
        </p>
        <h2 id="disclosure-heading" className="mt-1 text-[19px] font-semibold leading-snug text-al-text">
          Review the vehicle&apos;s condition
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-al-text-muted">
          The dealership has supplied its condition report, history report and current photographs.
          Take a look, then acknowledge once — that is all we need to move to your recap.
        </p>
      </header>

      <div className="px-5 py-5 sm:px-6">
        {artifactUrls.length === 0 ? (
          // THE EMPTY STATE IS NOT A DEAD END. A dealership can confirm without attaching every
          // artefact; the buyer still has to acknowledge to proceed, and pretending there are
          // documents when there are none is worse than saying so.
          <p
            className="rounded-al-md border border-al-border bg-al-bg px-4 py-3 text-[14px] leading-relaxed text-al-text-muted"
            data-testid="disclosure-no-artifacts"
          >
            The dealership did not attach a condition report, history report or photographs. You can
            still continue — and you can ask them for these before you sign anything.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="disclosure-artifacts">
            {artifactUrls.map((url, i) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[48px] items-center gap-3 rounded-al-md border border-al-border bg-al-surface px-4 py-3 text-[15px] font-medium text-al-primary transition-colors hover:bg-al-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
                  data-testid={`disclosure-artifact-${i}`}
                >
                  <FileText size={16} aria-hidden="true" className="shrink-0" />
                  <span className="break-all">Document {i + 1}</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-al-text">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-al-border-strong text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
            data-testid="disclosure-checkbox"
          />
          <span>
            I have seen the condition information the dealership provided for this vehicle.
          </span>
        </label>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] text-al-danger-fg"
            data-testid="disclosure-error"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={acknowledge}
          disabled={!checked || busy}
          data-testid="disclosure-acknowledge"
          className="mt-5 min-h-[52px] w-full rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg transition-colors hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle sm:w-auto"
        >
          {busy ? "Saving…" : "Acknowledge and continue to my recap"}
        </button>
      </div>
    </section>
  );
}

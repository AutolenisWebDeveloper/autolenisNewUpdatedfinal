"use client";

// The homepage hero's Lane 1 capture.
//
// §6.1's surface map opens with "Homepage hero — 'Find my car' / start request —
// captures vehicle interest, ZIP, contact — produces Lead + Vehicle Request draft".
// There was no form: the hero rendered two links to /auth/signup, so the first
// thing the surface map asks for was the first thing missing, and every visitor
// who was not ready to create an account left no trace at all.
//
// It posts to /api/public/request-vehicle with `draft: true` — THE one Lane 1
// handler (§5 rule 1), in its DRAFT mode (§5 rule 6: "incomplete is a draft, never
// a dead end"). A second "quick capture" endpoint would be a page implementing its
// own capture logic, which is precisely what rule 1 forbids.
//
// THREE FIELDS, AND THE ZIP IS ONE OF THEM. §5 rule 3: "ZIP is requested on every
// Lane 1 form and written to both the lead and the Vehicle Request." That rule
// exists because of §7.1 — a paid auction that received zero dealer invitations
// because the buyer record carried no location. A hero form that skipped the ZIP
// to reduce friction would be re-creating the defect at the very top of the funnel.
//
// FAILURE RENDERS AS FAILURE. A submit that does not succeed shows the reason and
// leaves the values in place; it never clears the form and shows a success state.
// The one branch that is NOT a failure is `requiresClaim` — the address belongs to
// a registered account and, per rule 16, nothing was attached — and it gets its own
// message rather than being dressed up as "your request is in".

import { useState } from "react";
import { ArrowRight, Loader2, CheckCircle2, AlertTriangle, Mail } from "lucide-react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "captured" }
  | { kind: "claim-sent"; message: string | null }
  | { kind: "error"; message: string };

export default function HeroIntakeForm() {
  const [email, setEmail] = useState("");
  const [zip, setZip] = useState("");
  const [interest, setInterest] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const submitting = status.kind === "submitting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!/^\d{5}$/.test(zip.trim())) {
      setStatus({ kind: "error", message: "Enter a 5-digit ZIP so we can find dealers near you." });
      return;
    }
    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/public/request-vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft: true,
          email: email.trim(),
          zip: zip.trim(),
          interest: interest.trim() || undefined,
          source: "homepage_hero",
          source_url: typeof window !== "undefined" ? window.location.href : undefined,
          referrer: typeof document !== "undefined" && document.referrer ? document.referrer : undefined,
        }),
      });

      // A non-2xx is a failure and is shown as one. Parsing is guarded because an
      // error page is not always JSON.
      const body = (await res.json().catch(() => null)) as
        | {
            success?: boolean;
            requiresClaim?: boolean;
            vehicleRequestId?: string | null;
            message?: string | null;
            error?: { message?: string };
          }
        | null;

      if (!res.ok || !body?.success) {
        setStatus({
          kind: "error",
          message: body?.error?.message ?? "We could not save that just now. Try again in a moment.",
        });
        return;
      }

      // `requiresClaim` alone is NOT the claim case. The API sets it for ordinary
      // guest captures too — the same emailed link claims them — and those DID
      // create a request. The case that must not be dressed up as "your request is
      // in" is the one where NOTHING was attached, which the API reports as
      // `requiresClaim` with a null `vehicleRequestId` (and a `message` saying so).
      // Branching on the flag alone told every first-time visitor that their
      // address already had an AutoLenis account.
      const nothingAttached = Boolean(body.requiresClaim) && !body.vehicleRequestId;
      setStatus(
        nothingAttached
          ? { kind: "claim-sent", message: body.message ?? null }
          : { kind: "captured" },
      );
    } catch {
      setStatus({ kind: "error", message: "We could not reach the server. Check your connection and try again." });
    }
  }

  if (status.kind === "captured" || status.kind === "claim-sent") {
    return (
      <div
        className="rounded-lg border border-[#D1D5DB] bg-white p-6"
        data-testid="hero-intake-success"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          {status.kind === "captured" ? (
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[#0B5FD1]" aria-hidden />
          ) : (
            <Mail size={20} className="mt-0.5 shrink-0 text-[#0B5FD1]" aria-hidden />
          )}
          <div>
            <p className="font-semibold text-[#111827]">
              {status.kind === "captured" ? "Saved — check your email" : "Check your email to continue"}
            </p>
            <p className="mt-1 text-sm text-[#4B5563]">
              {status.kind === "captured"
                ? "We sent you a link to finish your request. Nothing is charged until you review offers."
                : (status.message ??
                  "That address already has an AutoLenis account. For your security we sent a link there rather than adding this request to it.")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[#D1D5DB] bg-white p-6" data-testid="hero-intake-form" noValidate>
      <p className="mb-4 text-sm font-semibold text-[#111827]">Start in 30 seconds — no account needed yet.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="hero-email" className="block text-xs font-medium text-[#4B5563] mb-1">
            Email
          </label>
          <input
            id="hero-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="hero-intake-email"
            className="w-full rounded-md border border-[#D1D5DB] px-3 py-2.5 text-sm text-[#111827] focus:border-[#0B5FD1] focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="hero-zip" className="block text-xs font-medium text-[#4B5563] mb-1">
            ZIP code
          </label>
          <input
            id="hero-zip"
            name="zip"
            inputMode="numeric"
            required
            autoComplete="postal-code"
            maxLength={5}
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            data-testid="hero-intake-zip"
            className="w-full rounded-md border border-[#D1D5DB] px-3 py-2.5 text-sm text-[#111827] focus:border-[#0B5FD1] focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
            placeholder="75035"
          />
        </div>

        <div>
          <label htmlFor="hero-interest" className="block text-xs font-medium text-[#4B5563] mb-1">
            What are you looking for? <span className="font-normal text-[#9CA3AF]">(optional)</span>
          </label>
          <input
            id="hero-interest"
            name="interest"
            type="text"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            data-testid="hero-intake-interest"
            className="w-full rounded-md border border-[#D1D5DB] px-3 py-2.5 text-sm text-[#111827] focus:border-[#0B5FD1] focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
            placeholder="Used SUV under $35k"
          />
        </div>
      </div>

      {status.kind === "error" && (
        <p
          className="mt-3 flex items-start gap-2 text-sm text-[#B42318]"
          role="alert"
          data-testid="hero-intake-error"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{status.message}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        data-testid="hero-intake-submit"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0B5FD1] px-8 py-3.5 text-sm font-semibold text-white shadow-md shadow-[#0B5FD1]/25 transition-colors hover:bg-[#1A6FE0] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          <>
            Find my car <ArrowRight size={16} aria-hidden />
          </>
        )}
      </button>

      <p className="mt-3 text-xs leading-relaxed text-[#6B7280]">
        By continuing you agree to the AutoLenis Terms of Service and Privacy Policy. We email you about your
        request. Dealers compete for your business — you are never charged to see offers.
      </p>
    </form>
  );
}

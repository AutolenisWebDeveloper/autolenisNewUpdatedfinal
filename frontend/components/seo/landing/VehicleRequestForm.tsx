"use client";

// ───────────────────────────────────────────────────────────────────────────
//  Shared vehicle-request form for the ORGANIC SEO pages
//  (/car-buying-service/texas + /car-buying-service/[city]).
//
//  ⚠️ DELIBERATE DIVERGENCE FROM THE PAID LP FORM ⚠️
//  This is intentionally a SEPARATE component from the paid landing page form,
//  which is inlined inside app/(public)/lp/[campaign]/LandingPageClient.tsx.
//  The two are kept apart by design (decision: Phase 1, option (a)) so that
//  changes to the conversion-optimized organic form can NEVER disturb the live,
//  high-converting paid Facebook funnel. Both POST to the same endpoint
//  (/api/public/request-vehicle) with the same payload shape. Do not "DRY these
//  up" without re-reading the Phase 0 audit — the separation is load-bearing.
//
//  This is the only Client Component on the SEO pages; everything else stays a
//  Server Component so metadata/JSON-LD/static content render server-side.
// ───────────────────────────────────────────────────────────────────────────

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldCheck, ArrowRight } from "lucide-react";
import type { FormSource } from "@/lib/seo/locations";
import { trackFunnelEvent } from "@/lib/analytics/funnel-events";

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"] as const;
const BUDGETS = [
  "Under $15,000",
  "$15,000–$25,000",
  "$25,000–$35,000",
  "$35,000–$50,000",
  "$50,000–$75,000",
  "$75,000+",
] as const;
const TIMELINES = ["ASAP", "Within 30 Days", "Within 60 Days", "Just Researching"] as const;

interface VehicleRequestFormProps {
  /** Semantic attribution persisted to VehicleRequest.landingSource. */
  source: FormSource;
  /** Optional CTA label override. Benefit-led — never "Submit". */
  ctaLabel?: string;
}

interface Attribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source_url: string | null;
  referrer: string | null;
}

export default function VehicleRequestForm({
  source,
  ctaLabel = "Start My Free Car Request",
}: VehicleRequestFormProps) {
  const router = useRouter();
  const formId = useId();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capture attribution on mount (client-only — referrer/UTM/path).
  const [attribution, setAttribution] = useState<Attribution>({
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    source_url: null,
    referrer: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    setAttribution({
      utm_source: sp.get("utm_source"),
      utm_medium: sp.get("utm_medium"),
      utm_campaign: sp.get("utm_campaign"),
      source_url: window.location.href,
      referrer: document.referrer || null,
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone || !zip || !vehicleType || !budget || !timeline) {
      setError("Please complete every field so dealers can compete for your request.");
      return;
    }
    if (!/^\d{5}$/.test(zip)) {
      setError("Please enter a valid 5-digit ZIP code.");
      return;
    }
    setError(null);
    setSubmitting(true);

    const payload = {
      firstName,
      lastName,
      email,
      phone,
      zip,
      vehicleType,
      budget,
      timeline,
      openToAlternatives: true,
      agreedToContact: true as const,
      // attribution
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      source_url: attribution.source_url,
      referrer: attribution.referrer,
      // semantic FormSource → VehicleRequest.landingSource
      source,
      consent_email: true,
      consent_sms: true,
    };

    try {
      const res = await fetch("/api/public/request-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Submission failed. Please try again.");
      }
      trackFunnelEvent("lp_form_submit", {
        source,
        budget,
        timeline,
        vehicle_type: vehicleType,
      });
      if (typeof window !== "undefined") {
        window.fbq?.("track", "Lead", { currency: "USD", value: 0 });
      }
      router.push("/thank-you");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  const fieldClass =
    "w-full min-h-[48px] rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#0B5FD1] focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

  return (
    <form onSubmit={handleSubmit} aria-label="Vehicle request" data-testid="seo-vehicle-request-form" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor={`${formId}-first`}>First name</label>
          <input id={`${formId}-first`} className={fieldClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-last`}>Last name</label>
          <input id={`${formId}-last`} className={fieldClass} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-email`}>Email</label>
          <input id={`${formId}-email`} type="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-phone`}>Phone</label>
          <input id={`${formId}-phone`} type="tel" className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-zip`}>ZIP code</label>
          <input id={`${formId}-zip`} inputMode="numeric" maxLength={5} className={fieldClass} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} autoComplete="postal-code" required />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-vehicle`}>Vehicle type</label>
          <select id={`${formId}-vehicle`} className={fieldClass} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} required>
            <option value="" disabled>Select…</option>
            {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-budget`}>Budget</label>
          <select id={`${formId}-budget`} className={fieldClass} value={budget} onChange={(e) => setBudget(e.target.value)} required>
            <option value="" disabled>Select…</option>
            {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${formId}-timeline`}>Timeline</label>
          <select id={`${formId}-timeline`} className={fieldClass} value={timeline} onChange={(e) => setTimeline(e.target.value)} required>
            <option value="" disabled>Select…</option>
            {TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert" data-testid="seo-form-error">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        data-testid="seo-form-submit"
        className="mt-6 w-full min-h-[52px] rounded-lg bg-[#0B5FD1] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#0B5FD1]/20 transition-colors hover:bg-[#0944a8] disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {submitting ? "Sending your request…" : <>{ctaLabel} <ArrowRight size={18} /></>}
      </button>

      {/* CRO + data-security microcopy at the prequalification step. */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><Lock size={12} /> Secure &amp; encrypted</span>
        <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> We never sell your information</span>
        <span>No credit impact to start</span>
      </div>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
        Free to submit. Submitting starts a soft prequalification only and does not affect your credit score.
        By submitting you agree to be contacted by AutoLenis about your request.
      </p>
    </form>
  );
}

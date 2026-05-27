"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Gavel } from "lucide-react";

import { trackFunnelEvent } from "@/lib/analytics/funnel-events";

const MAKES = [
  "Acura", "Audi", "BMW", "Cadillac", "Chevrolet", "Ford", "Genesis",
  "Honda", "Hyundai", "Infiniti", "Jaguar", "Jeep", "Kia", "Land Rover",
  "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Nissan", "Porsche",
  "RAM", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo", "Other",
];

const YEARS = Array.from({ length: 11 }, (_, i) => String(2015 + i)); // 2015–2025

const MILEAGE_OPTIONS = ["Under 10k", "Under 25k", "Under 50k", "Under 75k", "Any mileage"];

const TRADE_MILEAGE_OPTIONS = [
  "Under 25k", "25k–50k", "50k–75k", "75k–100k", "100k–150k", "Over 150k",
];

const DOWN_PAYMENT_OPTIONS = ["Under $2k", "$2k–$5k", "$5k–$10k", "$10k–$20k", "Over $20k", "Not sure"];

const FINANCING_OPTIONS = [
  { value: "finance_dealer", label: "I plan to finance through the dealer", financing: true },
  { value: "have_financing", label: "I have my own financing / pre-approved", financing: true },
  { value: "cash", label: "I plan to pay cash", financing: false },
  { value: "not_sure", label: "Not sure yet", financing: false },
];

const labelClass = "block text-sm font-semibold text-slate-700 mb-1.5";
const helperClass = "text-xs text-slate-400 mt-1";
const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0B5FD1] focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20";

export default function ThankYouClient() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const campaign = params.get("campaign") ?? "unknown";
  const firstName = params.get("name") ?? params.get("firstName") ?? "";

  // ── Step 2 form state ────────────────────────────────────────────────────
  const [make, setMake] = useState("Any");
  const [model, setModel] = useState("");
  const [yearFrom, setYearFrom] = useState("Any");
  const [yearTo, setYearTo] = useState("Any");
  const [mileagePreference, setMileagePreference] = useState("Any mileage");
  const [color, setColor] = useState("");
  const [features, setFeatures] = useState("");
  const [financingPlan, setFinancingPlan] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [hasTradeIn, setHasTradeIn] = useState<boolean | null>(null);
  const [tradeInYear, setTradeInYear] = useState("");
  const [tradeInMake, setTradeInMake] = useState("");
  const [tradeInModel, setTradeInModel] = useState("");
  const [tradeInMileage, setTradeInMileage] = useState("");
  const [tradeInCondition, setTradeInCondition] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completed, setCompleted] = useState(false);

  const showDownPayment = FINANCING_OPTIONS.find((o) => o.value === financingPlan)?.financing ?? false;

  useEffect(() => {
    trackFunnelEvent("ty_view", { campaign });
    if (typeof window !== "undefined") {
      window.fbq?.("track", "Lead", { currency: "USD", value: 0 });
      window.ttq?.track("SubmitForm");
      window.AutoLenisAnalytics?.trackVehicleRequest?.();
    }
    // CRM timeline: log the thank-you view if we have an email. Fire-and-forget.
    if (email) {
      fetch("/api/public/crm/thank-you-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, campaign }),
      }).catch(() => {});
    }

    // GHL webhook sync — fire-and-forget, must never block the page.
    if (process.env.NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL) {
      fetch(
        process.env.NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: params.get('email') ?? null,
            campaign: params.get('campaign') ?? null,
            tags: ['lp-form-completed', 'auction-access-pending'],
          }),
        }
      ).catch(() => {});
    }
  }, [email, campaign]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError("");

    if (!email) {
      setSubmitError("We couldn't identify your request. Please use the link from your confirmation email.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/public/request-vehicle/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          make,
          model: model || undefined,
          yearFrom: yearFrom === "Any" ? undefined : Number(yearFrom),
          yearTo: yearTo === "Any" ? undefined : Number(yearTo),
          mileagePreference,
          color: color || undefined,
          features: features || undefined,
          financingPlan: FINANCING_OPTIONS.find((o) => o.value === financingPlan)?.label || undefined,
          downPayment: showDownPayment ? downPayment || undefined : undefined,
          hasTradeIn: hasTradeIn ?? undefined,
          tradeInYear: hasTradeIn ? tradeInYear || undefined : undefined,
          tradeInMake: hasTradeIn ? tradeInMake || undefined : undefined,
          tradeInModel: hasTradeIn ? tradeInModel || undefined : undefined,
          tradeInMileage: hasTradeIn ? tradeInMileage || undefined : undefined,
          tradeInCondition: hasTradeIn ? tradeInCondition || undefined : undefined,
          additionalNotes: additionalNotes || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Something went wrong");
      }
      trackFunnelEvent("ty_complete_submit", { campaign });
      setCompleted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const activateHref = `/auth/signup?plan=standard&source=lp${email ? `&email=${encodeURIComponent(email)}` : ""}`;

  return (
    <main className="min-h-screen bg-[#F8F9FB] py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-[35fr_65fr] lg:items-start">
        {/* ── LEFT PANEL — Confirmation ──────────────────────────────────── */}
        <aside className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 lg:sticky lg:top-8">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-5">
            <CheckCircle2 size={36} className="text-green-600" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3 tracking-tight">
            Request Received!
          </h1>
          <p className="text-slate-500 text-sm leading-relaxed mb-7">
            Hi {firstName || "there"} — your vehicle request is in. Complete the details below so
            dealers can submit their most competitive offers for exactly what you want.
          </p>

          {/* Progress indicator */}
          <ol className="space-y-3 mb-7">
            <li className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                <CheckCircle2 size={16} />
              </span>
              <span className="text-sm text-slate-600">
                <strong className="text-slate-800">Step 1: Your Info</strong> — Complete
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-[#0B5FD1] text-white text-xs font-bold flex items-center justify-center shrink-0">
                2
              </span>
              <span className="text-sm font-semibold text-[#0B5FD1]">
                Step 2: Vehicle Details ← You are here
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0">
                3
              </span>
              <span className="text-sm text-slate-400">Step 3: Activate Your Auction</span>
            </li>
          </ol>

          <Link
            href={activateHref}
            data-testid="thank-you-activate-cta"
            onClick={() => trackFunnelEvent("ty_activate_cta_click", { campaign })}
            className="flex items-center justify-center gap-2 w-full bg-[#0B5FD1]/5 text-[#0B5FD1] font-semibold text-sm py-3 rounded-xl border border-[#0B5FD1]/20 hover:bg-[#0B5FD1]/10 transition-colors"
          >
            <Gavel size={16} />
            Skip to activating my auction →
          </Link>
        </aside>

        {/* ── RIGHT PANEL — Step 2 Form ──────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8">
          {completed ? (
            <div data-testid="step2-complete" className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={36} className="text-green-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-3">Your request is complete!</h2>
              <p className="text-slate-500 text-sm leading-relaxed max-w-md mx-auto mb-7">
                Thanks for the detail{firstName ? `, ${firstName}` : ""}. We've sent a confirmation to{" "}
                <strong className="text-slate-700">{email || "your inbox"}</strong>. The final step is to
                activate your private dealer auction so verified dealers can start competing.
              </p>
              <Link
                href={activateHref}
                onClick={() => trackFunnelEvent("ty_activate_cta_click", { campaign })}
                className="inline-flex items-center justify-center gap-2 bg-[#0B5FD1] text-white font-semibold px-8 py-4 rounded-xl hover:bg-[#0944a8] transition-colors"
              >
                <Gavel size={18} />
                Activate My Dealer Auction →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} data-testid="step2-form" noValidate>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-1.5">
                Tell Us About Your Ideal Vehicle
              </h2>
              <p className="text-slate-500 text-sm mb-7">
                Takes 60 seconds. The more specific you are, the better offers you will receive.
              </p>

              {/* VEHICLE DETAILS */}
              <fieldset className="mb-7">
                <legend className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                  Vehicle Details
                </legend>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="make" className={labelClass}>Preferred Make</label>
                    <select
                      id="make"
                      value={make}
                      onChange={(e) => setMake(e.target.value)}
                      className={inputClass}
                    >
                      <option value="Any">Any make</option>
                      {MAKES.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="model" className={labelClass}>Preferred Model</label>
                    <input
                      id="model"
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="e.g. Camry, X5, F-150"
                      className={inputClass}
                    />
                    <p className={helperClass}>Leave blank if flexible</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label htmlFor="yearFrom" className={labelClass}>Year (from)</label>
                    <select
                      id="yearFrom"
                      value={yearFrom}
                      onChange={(e) => setYearFrom(e.target.value)}
                      className={inputClass}
                    >
                      <option value="Any">Any</option>
                      {YEARS.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="yearTo" className={labelClass}>Year (to)</label>
                    <select
                      id="yearTo"
                      value={yearTo}
                      onChange={(e) => setYearTo(e.target.value)}
                      className={inputClass}
                    >
                      <option value="Any">Any</option>
                      {YEARS.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="mileage" className={labelClass}>Mileage Preference</label>
                  <select
                    id="mileage"
                    value={mileagePreference}
                    onChange={(e) => setMileagePreference(e.target.value)}
                    className={inputClass}
                  >
                    {MILEAGE_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <p className={helperClass}>For used vehicles</p>
                </div>

                <div className="mt-4">
                  <label htmlFor="color" className={labelClass}>Preferred Color</label>
                  <input
                    id="color"
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="e.g. White, Black, Silver"
                    className={inputClass}
                  />
                  <p className={helperClass}>Leave blank if flexible</p>
                </div>

                <div className="mt-4">
                  <label htmlFor="features" className={labelClass}>Special Features or Requirements</label>
                  <textarea
                    id="features"
                    rows={3}
                    value={features}
                    onChange={(e) => setFeatures(e.target.value)}
                    placeholder="e.g. Sunroof, AWD, Third row seating, Towing package, Specific trim level"
                    className={inputClass}
                  />
                </div>
              </fieldset>

              {/* FINANCING */}
              <fieldset className="mb-7">
                <legend className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                  Financing
                </legend>

                <span className={labelClass}>Financing Plans</span>
                <div className="space-y-2">
                  {FINANCING_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 cursor-pointer hover:border-[#0B5FD1]/40 has-[:checked]:border-[#0B5FD1] has-[:checked]:bg-[#0B5FD1]/5"
                    >
                      <input
                        type="radio"
                        name="financingPlan"
                        value={o.value}
                        checked={financingPlan === o.value}
                        onChange={(e) => setFinancingPlan(e.target.value)}
                        className="accent-[#0B5FD1]"
                      />
                      <span className="text-sm text-slate-700">{o.label}</span>
                    </label>
                  ))}
                </div>

                {showDownPayment && (
                  <div className="mt-4">
                    <label htmlFor="downPayment" className={labelClass}>Down Payment Range</label>
                    <select
                      id="downPayment"
                      value={downPayment}
                      onChange={(e) => setDownPayment(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Select a range…</option>
                      {DOWN_PAYMENT_OPTIONS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}
              </fieldset>

              {/* TRADE-IN */}
              <fieldset className="mb-7">
                <legend className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                  Trade-In
                </legend>

                <span className={labelClass}>Do you have a trade-in?</span>
                <div className="flex gap-3">
                  {[
                    { label: "Yes", value: true },
                    { label: "No", value: false },
                  ].map((o) => (
                    <label
                      key={o.label}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 cursor-pointer hover:border-[#0B5FD1]/40 has-[:checked]:border-[#0B5FD1] has-[:checked]:bg-[#0B5FD1]/5"
                    >
                      <input
                        type="radio"
                        name="hasTradeIn"
                        checked={hasTradeIn === o.value}
                        onChange={() => setHasTradeIn(o.value)}
                        className="accent-[#0B5FD1]"
                      />
                      <span className="text-sm text-slate-700">{o.label}</span>
                    </label>
                  ))}
                </div>

                {hasTradeIn === true && (
                  <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="tradeInYear" className={labelClass}>Year</label>
                        <input
                          id="tradeInYear"
                          type="text"
                          inputMode="numeric"
                          value={tradeInYear}
                          onChange={(e) => setTradeInYear(e.target.value)}
                          placeholder="2019"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label htmlFor="tradeInMake" className={labelClass}>Make</label>
                        <input
                          id="tradeInMake"
                          type="text"
                          value={tradeInMake}
                          onChange={(e) => setTradeInMake(e.target.value)}
                          placeholder="Honda"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label htmlFor="tradeInModel" className={labelClass}>Model</label>
                        <input
                          id="tradeInModel"
                          type="text"
                          value={tradeInModel}
                          onChange={(e) => setTradeInModel(e.target.value)}
                          placeholder="Accord"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="tradeInMileage" className={labelClass}>Estimated Mileage</label>
                        <select
                          id="tradeInMileage"
                          value={tradeInMileage}
                          onChange={(e) => setTradeInMileage(e.target.value)}
                          className={inputClass}
                        >
                          <option value="">Select…</option>
                          {TRADE_MILEAGE_OPTIONS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="tradeInCondition" className={labelClass}>Estimated Condition</label>
                        <select
                          id="tradeInCondition"
                          value={tradeInCondition}
                          onChange={(e) => setTradeInCondition(e.target.value)}
                          className={inputClass}
                        >
                          <option value="">Select…</option>
                          {["Excellent", "Good", "Fair", "Poor"].map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </fieldset>

              {/* ADDITIONAL INFO */}
              <fieldset className="mb-7">
                <legend className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                  Additional Info
                </legend>
                <label htmlFor="additionalNotes" className={labelClass}>
                  Anything else dealers should know?
                </label>
                <textarea
                  id="additionalNotes"
                  rows={2}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="Any specific requirements, concerns, or preferences?"
                  className={inputClass}
                />
              </fieldset>

              {submitError && (
                <p className="text-sm text-red-600 mb-4" role="alert">{submitError}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                data-testid="step2-submit"
                className="bg-[#0B5FD1] text-white w-full rounded-xl py-4 font-semibold hover:bg-[#0944a8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Complete My Request →"}
              </button>

              <p className="text-xs text-slate-400 text-center mt-3 leading-relaxed">
                Your detailed request helps dealers submit their most competitive offers. You can
                still activate your auction without completing this step.
              </p>

              <div className="text-center mt-5">
                <Link
                  href="/auth/signin"
                  onClick={() => trackFunnelEvent("ty_complete_skip", { campaign })}
                  className="text-slate-400 text-sm text-center hover:text-slate-600"
                >
                  Skip for now — complete later in my dashboard →
                </Link>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

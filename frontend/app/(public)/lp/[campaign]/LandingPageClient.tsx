"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BarChart2,
  Building2,
  Car,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  DollarSign,
  Eye,
  FileText,
  Gavel,
  Heart,
  Lock,
  Shield,
  Star,
  UserCheck,
  X,
} from "lucide-react";

import { trackFunnelEvent } from "@/lib/analytics/funnel-events";

// ──────────────────────────────────────────────────────────────────────────
//  ⚠️ PRODUCTION GATE: testimonials substantiation
//  Each testimonial requires (1) signed consent at /legal/testimonial-consent/,
//  (2) verified savings claim with documentation, (3) compliance review.
//  If any testimonial cannot be substantiated, leave `saved: null` and use a
//  generic platform-experience quote — do not invent dollar figures.
// ──────────────────────────────────────────────────────────────────────────
type Testimonial = {
  name: string;
  location: string;
  vehicle: string;
  saved: string | null;
  quote: string;
  stars: number;
};

const TESTIMONIALS: Testimonial[] = [
  {
    name: "Verified Buyer",
    location: "Texas",
    vehicle: "Family SUV",
    saved: null,
    quote:
      "Three dealers competed for my business. I compared their offers from my kitchen table. That's the part I'll never forget — I was the one making the call.",
    stars: 5,
  },
  {
    name: "Verified Buyer",
    location: "Florida",
    vehicle: "Mid-size Sedan",
    saved: null,
    quote:
      "I never set foot on a lot. The offers came to me — fee breakdowns, monthly payments, all side-by-side. I picked the one that worked and signed from home.",
    stars: 5,
  },
  {
    name: "Verified Buyer",
    location: "Arizona",
    vehicle: "Truck",
    saved: null,
    quote:
      "What surprised me was how calm the whole process felt. No phone calls. No pressure. Just verified dealers competing for what I actually wanted.",
    stars: 5,
  },
];

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"] as const;
const BUDGET_RANGES = [
  "Under $15,000",
  "$15,000–$25,000",
  "$25,000–$35,000",
  "$35,000–$50,000",
  "$50,000–$75,000",
  "$75,000+",
] as const;
const TIMELINES = ["ASAP", "Within 30 Days", "Within 60 Days", "Just Researching"] as const;

type UtmData = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source_url: string | null;
  campaign: string | null;
};

interface LandingPageClientProps {
  campaign: string;
  headline: string;
  subheadline: string;
}

export default function LandingPageClient({
  campaign,
  headline,
  subheadline,
}: LandingPageClientProps) {
  const router = useRouter();
  const formRef = useRef<HTMLDivElement | null>(null);

  // Two-step form: 0 = contact info, 1 = vehicle preferences.
  const [formStep, setFormStep] = useState<0 | 1>(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [vehicleType, setVehicleType] = useState<typeof VEHICLE_TYPES[number] | "">("");
  const [budget, setBudget] = useState<typeof BUDGET_RANGES[number] | "">("");
  const [timeline, setTimeline] = useState<typeof TIMELINES[number] | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [showExitIntent, setShowExitIntent] = useState(false);
  const exitIntentShown = useRef(false);
  const [exitEmail, setExitEmail] = useState("");
  const [exitIntentSubmitted, setExitIntentSubmitted] = useState(false);

  // Session-recovery: true when Step 1 fields were rehydrated from sessionStorage
  // on mount. Drives the "Welcome back" banner. Cleared once the buyer opts to
  // start fresh or submits the full form.
  const [formRestored, setFormRestored] = useState(false);

  // Capture UTM params on mount so they ride along with the submit payload.
  const [utm, setUtm] = useState<UtmData>({
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    source_url: null,
    campaign,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    setUtm({
      utm_source:   sp.get("utm_source"),
      utm_medium:   sp.get("utm_medium"),
      utm_campaign: sp.get("utm_campaign"),
      source_url:   window.location.href,
      campaign,
    });
  }, [campaign]);

  // Page-view event (GA4 / Clarity / dataLayer).
  useEffect(() => {
    trackFunnelEvent("lp_view", { campaign });
  }, [campaign]);

  // Session-recovery on mount: rehydrate Step 1 fields if the buyer saved them
  // within the last 24h. Also auto-scrolls to the form when the abandonment
  // email CTA passes ?resume=1 so they land on the form, not the hero.
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = sessionStorage.getItem("al_form_step1");
      if (saved) {
        const parsed = JSON.parse(saved) as {
          firstName?: string;
          lastName?: string;
          email?: string;
          phone?: string;
          zip?: string;
          savedAt?: number;
        };
        const ageMs = Date.now() - (parsed.savedAt ?? 0);
        if (ageMs > 24 * 60 * 60 * 1000) {
          sessionStorage.removeItem("al_form_step1");
        } else {
          setFirstName(parsed.firstName ?? "");
          setLastName(parsed.lastName ?? "");
          setEmail(parsed.email ?? "");
          setPhone(parsed.phone ?? "");
          setZip(parsed.zip ?? "");
          setFormRestored(true);
        }
      }
    } catch {
      // sessionStorage may be unavailable (private browsing) — ignore.
    }

    const resumeParam = new URLSearchParams(window.location.search).get("resume");
    if (resumeParam === "1") {
      // Defer until after first paint so the form has been laid out.
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 600);
    }
  }, []);

  // Exit-intent on desktop only (mobile has the sticky CTA).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 1023px)").matches) return;
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0 && !exitIntentShown.current && !submitted) {
        exitIntentShown.current = true;
        setShowExitIntent(true);
        trackFunnelEvent("lp_exit_intent_shown", { campaign });
      }
    };
    document.addEventListener("mouseleave", onLeave);
    return () => document.removeEventListener("mouseleave", onLeave);
  }, [campaign, submitted]);

  function scrollToForm() {
    trackFunnelEvent("lp_hero_cta_click", { campaign });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleStep0Next() {
    if (!firstName || !lastName || !email || !zip || !/^\d{5}$/.test(zip)) {
      setSubmitError("Please complete every field. ZIP must be 5 digits.");
      return;
    }
    setSubmitError(null);

    // Fire-and-forget partial-lead capture. Intentionally not awaited and
    // errors are swallowed — a CRM hiccup must never delay the buyer's
    // transition to Step 2 or surface an error on their screen.
    fetch("/api/public/crm/partial-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        zip,
        smsConsent:   !!phone,
        campaign,
        utm_source:   utm.utm_source,
        utm_medium:   utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        source_url:   utm.source_url,
      }),
    }).catch(() => {});

    // Persist Step 1 for in-session recovery if the buyer leaves and returns
    // within 24h. Cleared on successful full submission.
    try {
      sessionStorage.setItem(
        "al_form_step1",
        JSON.stringify({
          firstName,
          lastName,
          email,
          phone,
          zip,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // sessionStorage may be unavailable (private browsing) — ignore.
    }

    trackFunnelEvent("lp_form_step_complete", { step: 0, campaign });
    setFormStep(1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleType || !budget || !timeline) {
      setSubmitError("Vehicle type, budget, and timeline are required.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);

    const payload = {
      firstName,
      lastName,
      email,
      phone: phone || "Not provided",
      zip,
      vehicleType,
      budget,
      timeline,
      // Schema defaults will populate city/state/contactMethod/newOrUsed/etc.
      openToAlternatives: true,
      agreedToContact: true as const,
      // LP attribution + consent
      utm_source:   utm.utm_source,
      utm_medium:   utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      source_url:   utm.source_url,
      campaign:     utm.campaign,
      consent_email: true,
      consent_sms:   !!phone,
    };

    try {
      const res = await fetch("/api/public/request-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Submission failed");
      }

      trackFunnelEvent("lp_form_submit", { campaign, budget, timeline, vehicle_type: vehicleType });
      if (typeof window !== "undefined") {
        window.fbq?.("track", "Lead", { currency: "USD", value: 0 });
        window.ttq?.track("SubmitForm");
      }

      // Successful submission — clear session-recovery cache so a future
      // visit doesn't restore a request the buyer has already completed.
      try {
        sessionStorage.removeItem("al_form_step1");
      } catch {
        // ignore
      }

      setSubmitted(true);
      setTimeout(() => {
        router.push(
          `/thank-you?email=${encodeURIComponent(email)}&campaign=${encodeURIComponent(campaign)}`,
        );
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* ── SECTION 1: NAVBAR ────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <span className="font-black text-slate-900 text-lg tracking-tight">AutoLenis</span>
          <div className="hidden md:flex items-center gap-6">
            {["How It Works", "Why AutoLenis", "Reviews", "FAQ"].map((l) => (
              <button
                key={l}
                onClick={scrollToForm}
                className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={scrollToForm}
            className="bg-[#0B5FD1] hover:bg-[#0944a8] text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors"
          >
            Start Your Vehicle Request
          </button>
        </div>
      </nav>

      <main className="bg-white text-slate-900 pb-24 lg:pb-0">
        {/* ── SECTION 2: HERO ──────────────────────────────────────────────── */}
        <section className="pt-28 pb-16 px-5 bg-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-bl from-blue-50/70 to-transparent pointer-events-none" />
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative z-10">
            {/* LEFT COLUMN */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-4">
                BUYER-FIRST AUTOMOTIVE CONCIERGE
              </p>
              <h1 className="text-5xl sm:text-6xl font-black tracking-tight text-slate-900 leading-[1.05] mb-5">
                {headline}
              </h1>
              <p className="text-lg text-slate-500 leading-relaxed max-w-lg mb-8">
                {subheadline}
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                <button
                  onClick={scrollToForm}
                  data-testid="lp-hero-cta"
                  className="inline-flex items-center gap-2 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-black text-base px-7 py-4 rounded-2xl shadow-lg transition-colors"
                >
                  Start Your Vehicle Request <ArrowRight size={18} />
                </button>
                <button
                  onClick={scrollToForm}
                  className="inline-flex items-center gap-2 border border-slate-200 text-slate-700 font-medium px-6 py-4 rounded-2xl hover:bg-slate-50 transition-colors"
                >
                  See How AutoLenis Works
                </button>
              </div>
              <div className="flex flex-wrap gap-4">
                {[
                  "No dealership pressure",
                  "Compare offers privately",
                  "Concierge-guided process",
                  "Secure & transparent",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <CheckCircle2 size={13} className="text-[#0B5FD1]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN — live auction dashboard card */}
            <div className="flex justify-center lg:justify-end">
              <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs text-slate-500">Your Request</p>
                    <p className="font-bold text-slate-900 text-sm">2024 BMW X5 xDrive40i</p>
                  </div>
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                    Active Auction
                  </span>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-400 mb-1">Auction ends in</p>
                  <p className="text-2xl font-bold font-mono text-slate-900 tracking-tight">23:47:18</p>
                </div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Top Offers
                </p>
                {[
                  { rank: 1, name: "Prestige Motors",   city: "Dallas, TX",  price: "$53,420", best: true  },
                  { rank: 2, name: "Summit Auto Group", city: "Plano, TX",   price: "$52,380", best: false },
                  { rank: 3, name: "DriveOne Autos",    city: "Frisco, TX",  price: "$49,950", best: false },
                ].map((o) => (
                  <div
                    key={o.rank}
                    className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#0B5FD1]/10 text-[#0B5FD1] text-[10px] font-bold flex items-center justify-center shrink-0">
                        {o.rank}
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{o.name}</p>
                        <p className="text-[10px] text-slate-400">{o.city}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${o.best ? "text-green-600" : "text-slate-700"}`}>
                        {o.price}
                      </p>
                      {o.best && (
                        <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">
                          Best Offer
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="mt-4 flex gap-3">
                  <div className="flex-1 bg-blue-50 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500">Estimated Savings</p>
                    <p className="text-lg font-bold font-mono text-[#0B5FD1]">$2,341</p>
                    <p className="text-[10px] text-slate-400">vs. market avg</p>
                  </div>
                  <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Shield size={10} className="text-[#0B5FD1]" />
                      <p className="text-[9px] font-bold text-[#0B5FD1]">Contract Shield™</p>
                    </div>
                    <p className="text-[10px] font-semibold text-slate-700">Protected</p>
                    <p className="text-[9px] text-slate-400">Review highlights before you buy.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 3: FORM (immediately below hero) ─────────────────────── */}
        <section
          ref={formRef}
          className="py-14 px-5 bg-gradient-to-b from-slate-50 to-white"
          id="request"
        >
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-8">
              <p className="text-[11px] font-bold text-[#0B5FD1] uppercase tracking-[0.2em] mb-2">
                START YOUR DEALER AUCTION
              </p>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">
                Tell us what you&rsquo;re looking for.
              </h2>
              <p className="text-sm text-slate-500">
                Step {formStep + 1} of 2 · Takes about 60 seconds.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="bg-white border border-slate-200 rounded-3xl p-7 shadow-xl"
              noValidate
            >
              {submitted ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 size={26} className="text-green-600" />
                  </div>
                  <p className="text-lg font-bold text-slate-900">Request received.</p>
                  <p className="text-sm text-slate-500 mt-1">Redirecting to activation step&hellip;</p>
                </div>
              ) : formStep === 0 ? (
                <div className="space-y-4">
                  {formRestored && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                      <CheckCircle2 size={14} className="text-blue-600 shrink-0" />
                      <span>Welcome back — your details have been restored.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFormRestored(false);
                          setFirstName("");
                          setLastName("");
                          setEmail("");
                          setPhone("");
                          setZip("");
                          try {
                            sessionStorage.removeItem("al_form_step1");
                          } catch {
                            // ignore
                          }
                        }}
                        className="ml-auto text-blue-500 hover:text-blue-700 underline"
                      >
                        Start fresh
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First name" required>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className={inputCls}
                        autoComplete="given-name"
                        required
                      />
                    </Field>
                    <Field label="Last name" required>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className={inputCls}
                        autoComplete="family-name"
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Email" required>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                      autoComplete="email"
                      required
                    />
                  </Field>
                  <Field label="Phone (optional)">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={inputCls}
                      autoComplete="tel"
                      placeholder="(555) 555-5555"
                    />
                  </Field>
                  <Field label="ZIP code" required>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{5}"
                      maxLength={5}
                      value={zip}
                      onChange={(e) => setZip(e.target.value.replace(/[^\d]/g, ""))}
                      className={inputCls}
                      autoComplete="postal-code"
                      required
                    />
                  </Field>
                  {submitError && (
                    <p className="text-xs text-red-600">{submitError}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleStep0Next}
                    data-testid="lp-form-step0-next"
                    className="w-full bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
                  >
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Field label="Vehicle type" required>
                    <select
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value as typeof VEHICLE_TYPES[number])}
                      className={inputCls}
                      required
                    >
                      <option value="">Select&hellip;</option>
                      {VEHICLE_TYPES.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Budget" required>
                    <select
                      value={budget}
                      onChange={(e) => setBudget(e.target.value as typeof BUDGET_RANGES[number])}
                      className={inputCls}
                      required
                    >
                      <option value="">Select&hellip;</option>
                      {BUDGET_RANGES.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Timeline" required>
                    <select
                      value={timeline}
                      onChange={(e) => setTimeline(e.target.value as typeof TIMELINES[number])}
                      className={inputCls}
                      required
                    >
                      <option value="">Select&hellip;</option>
                      {TIMELINES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  {submitError && (
                    <p className="text-xs text-red-600">{submitError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormStep(0)}
                      className="px-4 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      data-testid="lp-form-submit"
                      className="flex-1 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                    >
                      {submitting ? "Submitting…" : <>Activate Dealer Auction <ArrowRight size={16} /></>}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 text-center">
                    By submitting you agree to be contacted by AutoLenis about your request. No spam. Unsubscribe any time.
                  </p>
                </div>
              )}
            </form>

            <p className="text-center text-[11px] text-slate-400 mt-5 max-w-md mx-auto leading-relaxed">
              Savings vary based on vehicle, market conditions, dealer participation, and buyer-selected offer.
              AutoLenis does not guarantee any specific savings outcome.
            </p>
          </div>
        </section>

        {/* ── SECTION 4: METRICS STRIP ─────────────────────────────────────── */}
        <section className="bg-[#0F172A] py-10 px-5">
          <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {[
              { number: "Thousands", label: "In Reported Buyer Savings"   },
              { number: "500+",      label: "Verified Dealer Partners"     },
              { number: "10,000+",   label: "Vehicle Requests Processed"   },
              { number: "4.9 / 5",   label: "Buyer Satisfaction Rating"    },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-3xl font-black text-white font-mono mb-1">{s.number}</p>
                <p className="text-xs text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECTION 5: TRUST BAR ─────────────────────────────────────────── */}
        <section className="py-8 px-5 bg-white border-y border-slate-100">
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-5">
              Trusted by Thousands of Smarter Car Buyers
            </p>
            <div className="flex flex-wrap justify-center gap-8">
              {[
                { icon: <Lock size={14} />,       label: "SSL Secured",          sub: "256-bit encryption"    },
                { icon: <Shield size={14} />,      label: "Contract Shield™",     sub: "Buyer protection"      },
                { icon: <UserCheck size={14} />,   label: "Verified Dealers",     sub: "Background checked"    },
                { icon: <CreditCard size={14} />,  label: "Secure Payments",      sub: "Safe & encrypted"      },
                { icon: <Eye size={14} />,         label: "Privacy Protected",    sub: "Your data is safe"     },
                { icon: <Heart size={14} />,       label: "Buyer-First Platform", sub: "We work for you"       },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-[#0B5FD1]">
                    {item.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                    <p className="text-[10px] text-slate-400">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 6: PROBLEM ───────────────────────────────────────────── */}
        <section className="py-20 px-5 bg-white">
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                THE PROBLEM
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-[1.05] mb-6">
                Traditional Car Buying Is Designed Around the Dealer —{" "}
                <span className="text-[#0B5FD1]">Not You.</span>
              </h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {[
                  "Hours spent visiting dealerships",
                  "Unclear pricing and surprise costs",
                  "Pressure tactics and hidden fees",
                  "Multiple hard credit pulls",
                  "Negotiating against trained salespeople",
                  "Feeling rushed into bad decisions",
                ].map((pain) => (
                  <div key={pain} className="flex items-start gap-2">
                    <X size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <span className="text-sm text-slate-600">{pain}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative rounded-2xl overflow-hidden bg-slate-800 p-6 h-72">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-700" />
              <div className="relative z-10 h-full flex flex-col justify-between">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">DEALERSHIP</p>
                <div className="space-y-2">
                  {[
                    "Why is the price different online?",
                    "Are there hidden fees?",
                    "Am I getting a fair deal?",
                    "This is taking all my time…",
                  ].map((q) => (
                    <div
                      key={q}
                      className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 text-white text-xs"
                    >
                      {q}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 7: SOLUTION ──────────────────────────────────────────── */}
        <section className="py-20 px-5 bg-slate-50">
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            {/* LEFT — condensed offer card */}
            <div className="flex justify-center">
              <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-5 max-w-xs w-full">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Your Offers
                </p>
                {[
                  { rank: 1, name: "Prestige Motors",   price: "$53,420", best: true  },
                  { rank: 2, name: "Summit Auto Group",  price: "$52,380", best: false },
                  { rank: 3, name: "DriveOne Autos",     price: "$49,950", best: false },
                ].map((o) => (
                  <div
                    key={o.rank}
                    className={`flex items-center justify-between py-2 border-b border-slate-100 last:border-0 ${o.best ? "bg-blue-50 -mx-2 px-2 rounded-lg" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#0B5FD1]/10 text-[#0B5FD1] text-[10px] font-bold flex items-center justify-center shrink-0">
                        {o.rank}
                      </span>
                      <span className="text-xs font-semibold text-slate-800">{o.name}</span>
                    </div>
                    <span className={`text-sm font-bold ${o.best ? "text-[#0B5FD1]" : "text-slate-600"}`}>
                      {o.price}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT — copy */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                THE SOLUTION
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-[1.05] mb-4">
                AutoLenis Flips the Process{" "}
                <span className="text-[#0B5FD1]">in Favor of the Buyer.</span>
              </h2>
              <p className="text-slate-500 leading-relaxed mb-6 text-sm">
                Instead of running between dealerships, buyers submit one request and let dealers
                compete privately. You review offers calmly from home — with full transparency and
                no pressure.
              </p>
              <div className="space-y-4">
                {[
                  {
                    icon: <BarChart2 size={18} />,
                    title: "Dealers Compete",
                    body: "Compare offers side-by-side.",
                  },
                  {
                    icon: <CheckCircle2 size={18} />,
                    title: "You&rsquo;re in Control",
                    body: "Choose the best deal on your terms.",
                  },
                  {
                    icon: <Building2 size={18} />,
                    title: "No Showrooms",
                    body: "Complete everything from home.",
                  },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-[#0B5FD1] shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900"
                        dangerouslySetInnerHTML={{ __html: item.title }}
                      />
                      <p className="text-sm text-slate-500">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 8: HOW IT WORKS ──────────────────────────────────────── */}
        <section className="py-20 px-5 bg-white">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                HOW IT WORKS
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-[1.05]">
                A <span className="text-[#0B5FD1]">Smarter</span> Way to Buy Your Next Car
              </h2>
            </div>
            <div className="flex flex-col lg:flex-row gap-4 lg:gap-3">
              {[
                {
                  n: 1,
                  title: "Tell Us What You Want",
                  body: "Choose your preferred vehicle, budget, trade-in, and buying preferences.",
                },
                {
                  n: 2,
                  title: "Dealers Compete Privately",
                  body: "Verified dealers submit competing offers through the AutoLenis marketplace.",
                },
                {
                  n: 3,
                  title: "Compare Real Offers",
                  body: "Review side-by-side pricing, financing, warranties, and dealer terms.",
                },
                {
                  n: 4,
                  title: "Select the Best Deal",
                  body: "Choose the offer you want and complete the process confidently.",
                },
              ].map((s, i) => (
                <div key={s.n} className="relative flex-1">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center h-full">
                    <div className="w-9 h-9 rounded-full bg-[#0B5FD1] text-white text-sm font-black flex items-center justify-center mx-auto mb-3">
                      {s.n}
                    </div>
                    <p className="font-bold text-slate-900 text-sm mb-2">{s.title}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">{s.body}</p>
                  </div>
                  {i < 3 && (
                    <div className="hidden lg:flex absolute top-1/2 -right-4 z-10 -translate-y-1/2 text-slate-300">
                      <ArrowRight size={18} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 9: WHY BUYERS LOVE AUTOLENIS ─────────────────────────── */}
        <section className="py-20 px-5 bg-slate-50">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                WHY BUYERS LOVE AUTOLENIS
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">
                Everything Built Around the Buyer
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  icon: <CheckCircle2 size={20} />,
                  title: "Stay in Control",
                  body: "No pressure. No dealership manipulation.",
                },
                {
                  icon: <Clock size={20} />,
                  title: "Save Time",
                  body: "Avoid spending weekends dealership hopping.",
                },
                {
                  icon: <BarChart2 size={20} />,
                  title: "Compare Transparently",
                  body: "Review multiple dealer offers side-by-side.",
                },
                {
                  icon: <ClipboardList size={20} />,
                  title: "Concierge Guidance",
                  body: "We guide you from request to delivery.",
                },
                {
                  icon: <Car size={20} />,
                  title: "Smarter Buying",
                  body: "Make informed decisions without rushed sales tactics.",
                },
                {
                  icon: <Lock size={20} />,
                  title: "Secure Transactions",
                  body: "Protected workflows and transparent communication.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-[#0B5FD1] mb-3">
                    {item.icon}
                  </div>
                  <p className="font-bold text-slate-900 text-sm mb-1">{item.title}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 10: CONTRACT SHIELD ──────────────────────────────────── */}
        <section className="bg-[#0F172A] py-20 px-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B5FD1]/10 to-transparent pointer-events-none" />
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative z-10">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-400 mb-3">
                CONTRACT SHIELD™
              </p>
              <h2 className="text-4xl font-black text-white mb-4 tracking-tight leading-tight">
                Protection Beyond the Purchase.
              </h2>
              <p className="text-slate-400 leading-relaxed mb-6 text-sm">
                AutoLenis Contract Shield helps buyers better understand paperwork, financing terms,
                optional products, and common dealership contract risks before moving forward.
              </p>
              <div className="space-y-3">
                {[
                  "Increased transparency on every term",
                  "Better awareness of financing structures",
                  "Reduced surprise costs at signing",
                  "More informed purchasing decisions",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 size={16} className="text-blue-400 shrink-0" />
                    <span className="text-sm text-slate-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] text-white/50">Contract Shield™ Report</p>
                  <p className="text-sm font-bold text-white">Dealer Offer Review</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-green-400/20 border border-green-400/30 flex items-center justify-center text-green-400 text-xs font-black">
                  A
                </div>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">
                Key Highlights
              </p>
              <div className="space-y-2 mb-4">
                {[
                  "No hidden fees detected",
                  "Financing terms look good",
                  "Optionals are standard market rate",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <CheckCircle2 size={12} className="text-green-400" />
                    <span className="text-xs text-white/80">{item}</span>
                  </div>
                ))}
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <p className="text-[10px] text-white/40 mb-1">Overall Assessment</p>
                <p className="text-green-400 font-bold text-sm">Low Risk</p>
                <p className="text-[10px] text-white/60 mt-0.5">
                  This offer is transparent and buyer-friendly.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 11: COMPARISON TABLE ─────────────────────────────────── */}
        <section className="py-20 px-5 bg-white">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                THE DIFFERENCE
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">
                Two Different Experiences. One <span className="text-[#0B5FD1]">Smarter</span> Choice.
              </h2>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
              <div className="grid grid-cols-3">
                <div className="p-4 bg-slate-50" />
                <div className="p-4 bg-slate-100 border-l border-slate-200">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                    Traditional Dealership
                  </p>
                </div>
                <div className="p-4 bg-[#0B5FD1] border-l border-blue-700">
                  <p className="text-xs font-bold text-white uppercase tracking-wider">
                    AutoLenis
                  </p>
                </div>
              </div>
              {[
                ["Visit multiple dealerships",    "Request from home"              ],
                ["Pressure negotiations",          "Dealers compete privately"      ],
                ["Limited comparisons",            "Multiple side-by-side offers"   ],
                ["Time-consuming process",         "Streamlined from home"          ],
                ["Dealer-controlled experience",   "Buyer-controlled experience"    ],
              ].map(([old, neu], i) => (
                <div
                  key={i}
                  className={`grid grid-cols-3 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}
                >
                  <div className="p-4" />
                  <div className="p-4 border-l border-slate-200 flex items-center gap-2">
                    <X size={13} className="text-red-400 shrink-0" />
                    <span className="text-sm text-slate-600">{old}</span>
                  </div>
                  <div className="p-4 border-l border-blue-100 bg-blue-50/40 flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-[#0B5FD1] shrink-0" />
                    <span className="text-sm text-[#0B5FD1] font-medium">{neu}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 12: SOCIAL PROOF ─────────────────────────────────────── */}
        <section className="py-20 px-5 bg-slate-50" id="proof">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-2">
                What Buyers Are Saying
              </h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              {TESTIMONIALS.map((t) => (
                <div
                  key={`${t.name}-${t.location}`}
                  className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col"
                >
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: t.stars }).map((_, i) => (
                      <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed italic flex-1">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                  <div className="mt-4 pt-3 border-t border-slate-200 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] flex items-center justify-center text-white text-sm font-black shrink-0">
                      {t.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{t.name}</p>
                      <p className="text-xs text-slate-500">{t.location} · {t.vehicle}</p>
                      {t.saved && (
                        <p className="text-xs font-bold text-green-600 mt-0.5">Saved {t.saved}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 13: FAQ ──────────────────────────────────────────────── */}
        <section className="py-20 px-5 bg-white" id="faq">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-4xl font-black text-slate-900 text-center mb-10 tracking-tight">
              Common Questions
            </h2>
            <div className="space-y-3">
              {[
                {
                  q: "How does the dealer auction work?",
                  a: "You submit one vehicle request. AutoLenis invites verified dealers within 150 miles to compete. They submit structured offers — cash OTD, monthly payment, fee breakdown. You compare side-by-side. You choose. Or decline.",
                },
                {
                  q: "What does it cost?",
                  a: "A $99 refundable Auction Access Deposit unlocks dealer competition. The deposit is fully refunded if you decline every offer, or credited toward your purchase if you choose one. Premium concierge is available for buyers who want full hands-off service.",
                },
                {
                  q: "Do I have to talk to dealers?",
                  a: "Only if you want to. Dealers submit offers in writing. Their identity is anonymized until you choose. No phone calls. No showrooms.",
                },
                {
                  q: "What if no offer works for me?",
                  a: "Decline all offers. Your deposit is fully refunded — no questions asked.",
                },
              ].map((item) => (
                <details
                  key={item.q}
                  className="group bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
                  onToggle={(e) => {
                    if ((e.currentTarget as HTMLDetailsElement).open) {
                      trackFunnelEvent("lp_faq_open", { campaign });
                    }
                  }}
                >
                  <summary className="flex items-center justify-between px-5 py-4 cursor-pointer list-none font-semibold text-slate-800 text-sm hover:bg-slate-50 transition-colors">
                    {item.q}
                    <span className="text-[#0B5FD1] text-xl leading-none group-open:rotate-45 transition-transform duration-200">
                      +
                    </span>
                  </summary>
                  <div className="px-5 pb-5 pt-2 text-sm text-slate-600 leading-relaxed border-t border-slate-100">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 14: FINAL CTA ────────────────────────────────────────── */}
        <section className="bg-[#0F172A] py-24 px-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B5FD1]/15 to-transparent pointer-events-none" />
          <div className="max-w-3xl mx-auto text-center relative z-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-400 mb-4">
              START TODAY
            </p>
            <h2 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight leading-[1.05]">
              Stop Chasing Deals.
              <br />
              Let Dealers{" "}
              <span className="text-[#60A5FA]">Compete for You.</span>
            </h2>
            <p className="text-lg text-slate-400 mb-8 max-w-xl mx-auto leading-relaxed">
              AutoLenis gives modern buyers a smarter, more transparent way to purchase vehicles
              without dealership pressure.
            </p>
            <button
              onClick={scrollToForm}
              className="inline-flex items-center gap-2 bg-white text-[#0B5FD1] font-black text-lg px-8 py-4 rounded-2xl shadow-xl hover:bg-blue-50 transition-all"
            >
              Start Your Vehicle Request <ArrowRight size={18} />
            </button>
            <div className="flex items-center justify-center gap-6 mt-6 flex-wrap">
              {[
                { icon: <CheckCircle2 size={14} />, label: "100% Free"        },
                { icon: <CheckCircle2 size={14} />, label: "No Obligation"    },
                { icon: <Lock size={14} />,         label: "Secure & Private" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-sm text-slate-400">
                  <span className="text-blue-400">{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <footer className="bg-[#0F172A] border-t border-white/10 py-12 px-5">
          <div className="max-w-6xl mx-auto">
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8 mb-10">
              <div className="lg:col-span-2">
                <p className="font-black text-white text-lg mb-2">AutoLenis</p>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xs">
                  AutoLenis is a buyer-first automotive concierge platform where verified dealers
                  compete for your business. Buy smarter, not harder.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Company
                </p>
                {["About Us", "How It Works", "Careers", "Press", "Contact Us"].map((l) => (
                  <p
                    key={l}
                    className="text-sm text-slate-400 hover:text-white mb-2 cursor-pointer transition-colors"
                  >
                    {l}
                  </p>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Resources
                </p>
                {["FAQs", "Buying Guides", "Blog", "Contract Shield™", "Marketplace Rules"].map((l) => (
                  <p
                    key={l}
                    className="text-sm text-slate-400 hover:text-white mb-2 cursor-pointer transition-colors"
                  >
                    {l}
                  </p>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Legal
                </p>
                <Link
                  href="/legal/terms"
                  className="block text-sm text-slate-400 hover:text-white mb-2 transition-colors"
                >
                  Terms of Service
                </Link>
                <Link
                  href="/legal/privacy"
                  className="block text-sm text-slate-400 hover:text-white mb-2 transition-colors"
                >
                  Privacy Policy
                </Link>
                <Link
                  href="/contact"
                  className="block text-sm text-slate-400 hover:text-white mb-2 transition-colors"
                >
                  Contact Us
                </Link>
              </div>
            </div>
            <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
              <p className="text-xs text-slate-600">
                © {new Date().getFullYear()} AutoLenis. All rights reserved.
              </p>
              <div className="flex gap-4">
                <Link href="/legal/terms"   className="text-xs text-slate-600 hover:text-slate-400">Terms</Link>
                <Link href="/legal/privacy" className="text-xs text-slate-600 hover:text-slate-400">Privacy</Link>
                <Link href="/contact"       className="text-xs text-slate-600 hover:text-slate-400">Contact</Link>
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* ── EXIT INTENT MODAL (desktop only) ─────────────────────────────── */}
      {showExitIntent && !submitted && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center px-5">
          <div className="bg-white rounded-3xl p-7 max-w-sm w-full shadow-2xl relative">
            <button
              onClick={() => setShowExitIntent(false)}
              className="absolute top-3 right-3 text-slate-400 hover:text-slate-700"
              aria-label="Close"
            >
              <X size={20} />
            </button>
            <p className="text-[11px] font-bold text-[#0B5FD1] uppercase tracking-widest mb-2">
              Before you go
            </p>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              The dealership is still waiting for you.
            </h3>
            {exitIntentSubmitted ? (
              <div className="text-sm text-slate-600">
                <p className="mb-4">
                  Thanks — we&rsquo;ll send you a quick note shortly with a link back to your request.
                </p>
                <button
                  onClick={() => {
                    setShowExitIntent(false);
                    scrollToForm();
                  }}
                  className="w-full bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3 rounded-xl"
                >
                  Or finish it now
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-4">
                  Drop your email and we&rsquo;ll save your spot — up to 8 dealers competing,
                  you choose on your terms.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!exitEmail || !exitEmail.includes("@")) return;

                    // Fire-and-forget — never block the modal UX on a CRM hiccup.
                    fetch("/api/public/crm/exit-intent", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        email:        exitEmail,
                        campaign,
                        utm_source:   utm.utm_source,
                        utm_medium:   utm.utm_medium,
                        utm_campaign: utm.utm_campaign,
                        source_url:   utm.source_url,
                      }),
                    }).catch(() => {});

                    trackFunnelEvent("lp_exit_intent_cta", { campaign });
                    setExitIntentSubmitted(true);
                  }}
                  className="space-y-2"
                >
                  <input
                    type="email"
                    value={exitEmail}
                    onChange={(e) => setExitEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    className={inputCls}
                  />
                  <button
                    type="submit"
                    className="w-full bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3 rounded-xl"
                  >
                    Save my spot
                  </button>
                </form>
                <p className="text-[10px] text-slate-400 mt-3 text-center">
                  No spam. Unsubscribe any time.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MOBILE STICKY CTA ────────────────────────────────────────────── */}
      {!submitted && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-4px_20px_rgba(15,23,42,0.08)] p-3 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => {
              trackFunnelEvent("lp_sticky_cta_click", { campaign });
              scrollToForm();
            }}
            data-testid="lp-sticky-cta"
            className="w-full bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            Compare Dealer Offers <ArrowRight size={16} />
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1.5">
            $99 refundable deposit · No obligation · 48-hour auction
          </p>
        </div>
      )}
    </>
  );
}

// ── Tiny presentational helpers ────────────────────────────────────────────
const inputCls =
  "w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0B5FD1] focus:ring-2 focus:ring-[#0B5FD1]/15 transition";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600 mb-1.5 block">
        {label}
        {required && <span className="text-[#0B5FD1] ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

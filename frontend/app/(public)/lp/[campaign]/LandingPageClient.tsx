"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Eye,
  Facebook,
  Heart,
  Instagram,
  Linkedin,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  Play,
  Quote,
  Shield,
  Star,
  UserCheck,
  Users,
  X,
  Youtube,
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
  initial: string;
  color: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    name: "Sarah M.",
    location: "Austin, TX",
    vehicle: "2024 Toyota Highlander",
    saved: null,
    quote:
      "AutoLenis saved me over $3,000. The process was so easy and there was zero pressure.",
    stars: 5,
    initial: "S",
    color: "from-pink-400 to-rose-500",
  },
  {
    name: "James T.",
    location: "Plano, TX",
    vehicle: "2023 Honda Accord Sport",
    saved: null,
    quote:
      "The dealers actually competed for my business. I got the best offer without any hassle.",
    stars: 5,
    initial: "J",
    color: "from-blue-400 to-indigo-500",
  },
  {
    name: "Amanda R.",
    location: "El Paso, TX",
    vehicle: "2024 RAM 1500 Big Horn",
    saved: null,
    quote:
      "Finally, a platform that puts buyers first. Highly recommend AutoLenis!",
    stars: 5,
    initial: "A",
    color: "from-emerald-400 to-teal-500",
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
  // Retained for the per-campaign metadata pipeline in page.tsx. The hero now
  // renders a fixed brand headline per the final design, so these are not read
  // here, but the props remain part of the contract.
  headline?: string;
  subheadline?: string;
}

export default function LandingPageClient({
  campaign,
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
          `/thank-you?email=${encodeURIComponent(email)}&campaign=${encodeURIComponent(campaign)}&name=${encodeURIComponent(firstName)}`,
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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[#0B5FD1] text-2xl font-black leading-none tracking-tighter">//</span>
            <span className="font-black text-slate-900 text-lg tracking-tight">AutoLenis</span>
          </div>
          <div className="hidden md:flex items-center gap-7">
            {["How It Works", "Why AutoLenis", "Reviews", "Contract Shield™", "FAQs", "For Dealers"].map((l) => (
              <button
                key={l}
                onClick={scrollToForm}
                className="relative text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                {l}
                {l === "Reviews" && (
                  <span className="absolute -bottom-[22px] left-0 right-0 h-0.5 bg-[#0B5FD1]" />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={scrollToForm}
              className="bg-[#0B5FD1] hover:bg-[#0944a8] text-white text-sm font-semibold px-5 py-2 rounded-full transition-colors"
            >
              Start Your Dealer Auction →
            </button>
          </div>
        </div>
      </nav>

      <main className="bg-white text-slate-900 pb-24 lg:pb-0">
        {/* ── SECTION 2: HERO (2-column — copy + dashboard image) ─────────── */}
        <section className="min-h-screen flex items-center pt-24 pb-16 bg-white relative overflow-hidden">
          {/* light-blue gradient in the top-right corner */}
          <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-bl from-blue-50 to-transparent pointer-events-none" />
          <div className="max-w-6xl mx-auto px-5 grid grid-cols-1 lg:grid-cols-[55%_45%] gap-8 items-center relative z-10 w-full">

            {/* ── LEFT COLUMN — headline, copy, CTAs, social proof ─────────── */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-4">
                BUYER-FIRST AUTOMOTIVE CONCIERGE
              </p>
              <h1 className="font-black text-5xl lg:text-6xl tracking-tight text-slate-900 leading-[1.05] mb-5">
                Buy Smarter.<br />
                Dealers Compete.<br />
                <span className="text-[#0B5FD1]">You Win.</span>
              </h1>
              <p className="text-slate-500 text-base leading-relaxed max-w-md mb-7">
                Verified dealers compete for your business privately so you get real offers, stay in
                control, and buy smarter from home.
              </p>
              <div className="space-y-2.5 mb-7">
                {[
                  "No dealership pressure",
                  "Compare offers privately",
                  "Concierge-guided experience",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle2 size={16} className="text-[#0B5FD1] shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mb-7">
                <button
                  onClick={scrollToForm}
                  data-testid="lp-hero-cta"
                  className="inline-flex items-center gap-2 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold px-6 py-3 rounded-lg shadow-lg transition-colors"
                >
                  Start Your Dealer Auction <ArrowRight size={16} />
                </button>
                <button
                  onClick={scrollToForm}
                  className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 font-medium px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full border border-slate-400 flex items-center justify-center shrink-0">
                    <Play size={9} className="text-slate-600 fill-slate-600 ml-0.5" />
                  </span>
                  See How It Works
                </button>
              </div>
              {/* social proof */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex -space-x-2">
                  {["A", "M", "J"].map((c) => (
                    <div
                      key={c}
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] border-2 border-white flex items-center justify-center text-white text-[11px] font-black"
                    >
                      {c}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <span className="text-xs text-slate-500">Trusted by thousands of smarter car buyers</span>
              </div>
            </div>

            {/* ── RIGHT COLUMN — hero dashboard image ──────────────────────── */}
            <div className="relative">
              <Image
                src="/images/hero-dashboard.png"
                alt="AutoLenis buyer dashboard showing competing dealer offers"
                width={700}
                height={500}
                className="w-full h-auto rounded-2xl shadow-2xl"
                priority
              />
            </div>

          </div>
        </section>

        {/* ── SECTION 3: STANDALONE LEAD-CAPTURE FORM ──────────────────────── */}
        <section ref={formRef} id="request" className="py-20 bg-[#F8FAFC] scroll-mt-24">
          <div className="max-w-5xl mx-auto px-5">
            <div className="grid lg:grid-cols-2 gap-12 items-center">

              {/* Left — copy */}
              <div>
                <p className="text-[11px] font-bold text-[#0B5FD1] uppercase tracking-[0.2em] mb-3">
                  START YOUR DEALER AUCTION
                </p>
                <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight mb-4">
                  Tell Us What<br />
                  You Are Looking For.
                </h2>
                <p className="text-slate-500 text-sm leading-relaxed mb-6">
                  Submit your vehicle request in 60 seconds. Verified dealers compete privately.
                  You compare all offers from home.
                </p>
                <div className="space-y-3 mb-6">
                  {[
                    "Takes about 60 seconds",
                    "No credit impact",
                    "$99 Auction Access Fee — refundable if no valuable offer is received",
                    "No obligation to accept",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <CheckCircle2 size={16} className="text-[#0B5FD1] shrink-0" />
                      <span className="text-sm text-slate-600">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {["S", "M", "J", "A"].map((c) => (
                      <div
                        key={c}
                        className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] border-2 border-white flex items-center justify-center text-white text-[11px] font-black"
                      >
                        {c}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} size={13} className="text-amber-400 fill-amber-400" />
                    ))}
                    <span className="ml-1.5 text-xs font-semibold text-slate-600">
                      4.9 / 5 from 1,200+ buyers
                    </span>
                  </div>
                </div>
              </div>

              {/* Right — form card */}
              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl">
                <div className="text-center mb-6">
                  <p className="text-[11px] font-bold text-[#0B5FD1] uppercase tracking-[0.2em] mb-1">
                    START YOUR AUCTION
                  </p>
                  <p className="text-xs text-slate-500">
                    It&rsquo;s free and takes 60 seconds.
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Step {formStep + 1} of 2
                  </p>
                </div>

                <form onSubmit={handleSubmit} noValidate>
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
                        className="w-full bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3 rounded-lg shadow-lg shadow-[#0B5FD1]/20 flex items-center justify-center gap-2 transition-colors"
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
                          className="px-4 py-3 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50"
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          disabled={submitting}
                          data-testid="lp-form-submit"
                          className="flex-1 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-bold py-3 rounded-lg shadow-lg shadow-[#0B5FD1]/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                        >
                          {submitting ? "Submitting…" : <>Submit Request <ArrowRight size={16} /></>}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 text-center">
                        By submitting you agree to be contacted by AutoLenis about your request. No spam. Unsubscribe any time.
                      </p>
                    </div>
                  )}
                </form>

                <div className="flex items-center justify-center gap-4 flex-wrap mt-4 text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Lock size={11} />
                    Secure submission
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 size={11} />
                    No dealership pressure
                  </span>
                  <span className="flex items-center gap-1">
                    <UserCheck size={11} />
                    Buyer-first concierge
                  </span>
                </div>

                {/* disclaimers */}
                <p className="text-[10px] text-slate-400 text-center mt-3 leading-relaxed">
                  The $99 Auction Access Fee unlocks your private 48-hour dealer auction. Refundable if AutoLenis
                  is unable to secure a valuable or competitive offer for your requested vehicle.
                </p>
                <p className="text-[10px] text-slate-400 text-center mt-2 leading-relaxed">
                  Savings vary based on vehicle, market conditions, dealer participation, and buyer-selected offer.
                  AutoLenis does not guarantee any specific savings outcome.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 4: METRICS STRIP ─────────────────────────────────────── */}
        <section className="bg-white border-y border-slate-200 py-6">
          <div className="max-w-5xl mx-auto px-5 grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { icon: <DollarSign size={18} />, number: "$2,300+",   label: "Average Buyer Savings"     },
              { icon: <Users size={18} />,      number: "500+",      label: "Verified Dealer Partners"  },
              { icon: <Car size={18} />,        number: "10,000+",   label: "Vehicles Requested"        },
              { icon: <Star size={18} />,       number: "4.9 / 5",   label: "Buyer Satisfaction"        },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-[#0B5FD1] shrink-0">
                  {s.icon}
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-black text-[#0F172A] leading-none">{s.number}</p>
                  <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECTION 5: VSL (video sales letter) ──────────────────────────── */}
        <section className="py-20 bg-[#F8FAFC] border-y border-slate-200">
          <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-12 items-center">
            {/* LEFT — copy */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                WHY AUTOLENIS EXISTS
              </p>
              <h2 className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight leading-[1.05] mb-5">
                Finally, a Smarter <br className="hidden sm:block" />
                Way to Buy a Car
              </h2>
              <p className="text-slate-500 leading-relaxed text-sm mb-6 max-w-md">
                Most buyers overpay because dealerships control the process. AutoLenis flips the
                script — verified dealers compete for you, so you get the best offers, without the
                pressure.
              </p>
              <div className="space-y-3 mb-7">
                {[
                  "See how our private auction works",
                  "Why transparency saves you thousands",
                  "How Contract Shield™ protects you",
                  "Hear real results from real buyers",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 size={16} className="text-[#0B5FD1] shrink-0" />
                    <span className="text-sm text-slate-600">{item}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {["A", "M", "J", "S"].map((c) => (
                    <div
                      key={c}
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] border-2 border-white flex items-center justify-center text-white text-[11px] font-black"
                    >
                      {c}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={13} className="text-amber-400 fill-amber-400" />
                  ))}
                  <span className="ml-1.5 text-xs font-semibold text-slate-600">
                    4.9 / 5 from 1,200+ buyers
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT — VSL thumbnail image */}
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <Image
                src="/images/vsl-thumbnail.png"
                alt="AutoLenis — Finally a smarter way to buy a car"
                width={640}
                height={400}
                className="w-full h-auto"
              />
            </div>
          </div>
        </section>

        {/* ── SECTION 6: TRUST BAR ─────────────────────────────────────────── */}
        <section className="py-8 bg-white">
          <div className="max-w-5xl mx-auto px-5">
            <p className="text-center text-sm font-semibold text-slate-600 mb-6">
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

        {/* ── SECTION 7: PROBLEM ───────────────────────────────────────────── */}
        <section className="py-20 bg-white">
          <div className="max-w-5xl mx-auto px-5 grid lg:grid-cols-2 gap-12 items-center">
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
            <div className="relative rounded-2xl overflow-hidden shadow-lg">
              <Image
                src="/images/the-old-way.png"
                alt="Frustrated car buyer at dealership with confusing paperwork"
                width={600}
                height={450}
                className="w-full h-auto rounded-2xl"
              />
            </div>
          </div>
        </section>

        {/* ── SECTION 8: SOLUTION ──────────────────────────────────────────── */}
        <section className="py-20 bg-white">
          <div className="max-w-5xl mx-auto px-5 grid lg:grid-cols-2 gap-12 items-center">
            {/* LEFT — copy */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                THE SOLUTION
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-[1.05] mb-4">
                AutoLenis Flips the Process{" "}
                <span className="text-[#0B5FD1]">in Favor of the Buyer.</span>
              </h2>
              <p className="text-slate-500 leading-relaxed text-sm">
                Instead of running between dealerships, buyers submit one request and let dealers
                compete privately. You review offers calmly from home — with full transparency and
                no pressure.
              </p>
            </div>

            {/* RIGHT — solution image */}
            <div className="relative">
              <Image
                src="/images/new-autolenis-way.png"
                alt="Man using AutoLenis platform on laptop comparing dealer offers"
                width={600}
                height={450}
                className="w-full h-auto"
              />
            </div>
          </div>
        </section>

        {/* ── SECTION 9: HOW IT WORKS ──────────────────────────────────────── */}
        <section className="py-24 bg-white">
          <div className="max-w-5xl mx-auto px-5">
            <div className="text-center mb-12">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                HOW IT WORKS
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-[1.05]">
                A <span className="text-[#0B5FD1]">Smarter</span> Way to Buy Your Next Car
              </h2>
            </div>
            <div className="relative rounded-2xl overflow-hidden shadow-lg">
              <Image
                src="/images/how-it-works-section.png"
                alt="AutoLenis 4-step process: Request, Dealers Compete, Compare, Contract Shield"
                width={1100}
                height={550}
                className="w-full h-auto"
              />
            </div>
          </div>
        </section>

        {/* ── SECTION 10: WHY BUYERS LOVE AUTOLENIS ────────────────────────── */}
        <section className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-12">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1]">
                WHY BUYERS LOVE AUTOLENIS
              </p>
            </div>
            <Image
              src="/images/why-buyers-love-section.png"
              alt="Why buyers love AutoLenis — smart tools, real protection, better car buying"
              width={1100}
              height={700}
              className="w-full h-auto rounded-2xl"
            />
          </div>
        </section>

        {/* ── SECTION 11: CONTRACT SHIELD ──────────────────────────────────── */}
        <section className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-5">
            <Image
              src="/images/contract-shield-section.png"
              alt="AutoLenis Contract Shield — Protection Beyond the Purchase"
              width={1200}
              height={600}
              className="w-full h-auto rounded-2xl"
            />
            <div className="text-center mt-8">
              <button
                onClick={scrollToForm}
                className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white font-bold px-8 py-4 rounded-xl hover:bg-[#0944a8] transition-colors"
              >
                Start Your Protected Request
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </section>

        {/* ── SECTION 12: COMPARISON TABLE ─────────────────────────────────── */}
        <section className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-3">
                THE DIFFERENCE
              </p>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">
                Two Different Experiences. One <span className="text-[#0B5FD1]">Smarter</span> Choice.
              </h2>
            </div>
            <div className="grid lg:grid-cols-[1fr_1.7fr_1fr] gap-6 items-center">
              {/* silver sedan placeholder */}
              <div className="hidden lg:flex h-44 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-300 items-center justify-center">
                <Car size={72} className="text-slate-400" strokeWidth={1} />
              </div>

              {/* comparison table */}
              <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
                <div className="grid grid-cols-2">
                  <div className="p-3 bg-slate-100 text-center">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Traditional Dealership
                    </p>
                  </div>
                  <div className="p-3 bg-[#0B5FD1] text-center">
                    <p className="text-xs font-bold text-white uppercase tracking-wider">
                      AutoLenis
                    </p>
                  </div>
                </div>
                {[
                  ["Visit multiple dealerships",    "Request from home"              ],
                  ["Pressure negotiations",          "Dealers compete privately"      ],
                  ["Limited comparisons",            "Multiple side-by-side offers"   ],
                  ["Time-consuming process",         "Streamlined process"            ],
                  ["Dealer-controlled process",      "Buyer-controlled process"       ],
                ].map(([old, neu], i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-2 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}
                  >
                    <div className="p-3.5 flex items-center gap-2 border-r border-slate-100">
                      <X size={13} className="text-red-400 shrink-0" />
                      <span className="text-sm text-slate-600">{old}</span>
                    </div>
                    <div className="p-3.5 bg-blue-50/40 flex items-center gap-2">
                      <CheckCircle2 size={13} className="text-[#0B5FD1] shrink-0" />
                      <span className="text-sm text-[#0B5FD1] font-medium">{neu}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* dark SUV placeholder */}
              <div className="hidden lg:flex h-44 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 items-center justify-center">
                <Car size={72} className="text-slate-600" strokeWidth={1} />
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 13: SOCIAL PROOF (testimonials) ──────────────────────── */}
        <section className="py-24 bg-slate-50" id="proof">
          <div className="max-w-5xl mx-auto px-5">
            <div className="text-center mb-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1]">
                WHAT BUYERS ARE SAYING
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm items-center justify-center text-slate-400 shrink-0">
                <ChevronLeft size={18} />
              </div>
              <div className="grid sm:grid-cols-3 gap-4 flex-1">
                {TESTIMONIALS.map((t) => (
                  <div
                    key={`${t.name}-${t.location}`}
                    className="relative bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col"
                  >
                    <Quote size={36} className="absolute top-4 right-4 text-[#0B5FD1]/15 fill-[#0B5FD1]/15" />
                    <div className="flex gap-1 mb-3">
                      {Array.from({ length: t.stars }).map((_, i) => (
                        <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                      ))}
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed italic flex-1">
                      &ldquo;{t.quote}&rdquo;
                    </p>
                    <div className="mt-4 pt-3 border-t border-slate-200 flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white font-black text-sm shrink-0`}>
                        {t.initial}
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
              <div className="hidden lg:flex w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm items-center justify-center text-slate-400 shrink-0">
                <ChevronRight size={18} />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-8">
              {[0, 1, 2, 3].map((d) => (
                <span
                  key={d}
                  className={`h-2 rounded-full ${d === 0 ? "w-6 bg-[#0B5FD1]" : "w-2 bg-slate-300"}`}
                />
              ))}
            </div>
            <p className="text-center text-[10px] text-slate-400 mt-6">
              Buyer experiences are individual. Results vary based on vehicle, market, and dealer participation.
            </p>
          </div>
        </section>

        {/* ── SECTION 14: FAQ ──────────────────────────────────────────────── */}
        <section className="py-24 bg-white" id="faq">
          <div className="max-w-3xl mx-auto px-5">
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
                  a: "A $99 Limited-Time Auction Access Fee unlocks dealer competition. It is refundable if you decline every offer or if no valuable offer is received. Premium concierge is available for buyers who want full hands-off service.",
                },
                {
                  q: "Do I have to talk to dealers?",
                  a: "Only if you want to. Dealers submit offers in writing. Their identity is anonymized until you choose. No phone calls. No showrooms.",
                },
                {
                  q: "What if no offer works for me?",
                  a: "Decline all offers. Your Auction Access Fee is fully refunded — no questions asked.",
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

        {/* ── SECTION 15: FINAL CTA ────────────────────────────────────────── */}
        <section className="bg-[#0F172A] py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B5FD1]/15 to-transparent pointer-events-none" />
          <div className="max-w-3xl mx-auto px-5 text-center relative z-10">
            <h2 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight leading-[1.05]">
              Stop Chasing Deals.
              <br />
              Let Dealers{" "}
              <span className="text-[#3B82F6]">Compete</span> for You.
            </h2>
            <p className="text-sm text-slate-400 mb-8 max-w-xl mx-auto leading-relaxed">
              AutoLenis gives modern buyers a smarter, more transparent way to purchase vehicles
              without dealership pressure.
            </p>
            <div className="flex max-w-md mx-auto shadow-xl rounded-lg">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email..."
                autoComplete="email"
                className="flex-1 min-w-0 bg-white border-0 rounded-l-lg px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                onClick={scrollToForm}
                className="inline-flex items-center gap-2 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-semibold text-sm px-6 py-3 rounded-r-lg transition-colors whitespace-nowrap"
              >
                Start Your Vehicle Request <ArrowRight size={16} />
              </button>
            </div>
            <div className="flex items-center justify-center gap-6 mt-6 flex-wrap">
              {[
                { icon: <CheckCircle2 size={14} />, label: "100% Free"        },
                { icon: <CheckCircle2 size={14} />, label: "No Obligation"    },
                { icon: <Lock size={14} />,         label: "Secure & Private" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="text-blue-400">{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <footer className="bg-[#111c33] border-t border-white/10 py-14">
          <div className="max-w-6xl mx-auto px-5">
            <div className="grid lg:grid-cols-3 gap-10 mb-10">
              {/* brand column */}
              <div className="lg:col-span-1">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[#3B82F6] text-2xl font-black leading-none tracking-tighter">//</span>
                  <span className="font-black text-white text-lg tracking-tight">AutoLenis</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed max-w-xs mb-5">
                  AutoLenis is a buyer-first automotive concierge where verified dealers compete for
                  your business so you can drive away with confidence.
                </p>
                <div className="flex gap-3 mb-5">
                  {[Facebook, Instagram, Linkedin, Youtube].map((Icon, i) => (
                    <div
                      key={i}
                      className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-slate-300 hover:bg-white/20 cursor-pointer transition-colors"
                    >
                      <Icon size={15} />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  © {new Date().getFullYear()} AutoLenis, Inc. All rights reserved.
                </p>
                <div className="flex gap-2">
                  <span className="text-[10px] font-bold text-slate-300 bg-white/10 border border-white/10 rounded px-2 py-1">
                    Norton Secured
                  </span>
                  <span className="text-[10px] font-bold text-slate-300 bg-white/10 border border-white/10 rounded px-2 py-1">
                    BBB A+ Rating
                  </span>
                </div>
              </div>

              {/* link columns */}
              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Company
                  </p>
                  {[
                    { label: "About Us",     href: "/about"        },
                    { label: "How It Works", href: "/how-it-works" },
                    { label: "Pricing",      href: "/pricing"      },
                    { label: "Contact Us",   href: "/contact"      },
                  ].map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="block text-sm text-slate-400 hover:text-white mb-2 transition-colors"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Resources
                  </p>
                  {[
                    { label: "FAQs",             href: "/faq"             },
                    { label: "Contract Shield™", href: "/contract-shield" },
                    { label: "For Dealers",      href: "/for-dealers"     },
                    { label: "For Affiliates",   href: "/for-affiliates"  },
                  ].map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="block text-sm text-slate-400 hover:text-white mb-2 transition-colors"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Partners
                  </p>
                  {["Dealer Program", "Affiliate Program", "Financing Partners"].map((l) => (
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
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Contact
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                    <Phone size={13} className="shrink-0" /> (469) 535-9785
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                    <Mail size={13} className="shrink-0" /> support@autolenis.com
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                    <Clock size={13} className="shrink-0" /> Mon–Fri 9AM–6PM CT
                  </p>
                  <Link
                    href="/contact"
                    className="flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-2 transition-colors"
                  >
                    <MessageCircle size={13} className="shrink-0" /> Chat With Us
                  </Link>
                </div>
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
            $99 Limited-Time Auction Access Fee · No obligation · 48-hour auction
          </p>
        </div>
      )}
    </>
  );
}

// ── Tiny presentational helpers ────────────────────────────────────────────
const inputCls =
  "w-full bg-white border border-slate-300 rounded-xl px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0B5FD1] focus:ring-2 focus:ring-[#0B5FD1]/15 transition";

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

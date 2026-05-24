"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart2,
  Brain,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  Crown,
  DollarSign,
  Eye,
  Facebook,
  FileText,
  Gavel,
  Heart,
  Instagram,
  LayoutDashboard,
  Linkedin,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Quote,
  Scale,
  Shield,
  ShieldCheck,
  Star,
  Tag,
  Target,
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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[#0B5FD1] text-2xl font-black leading-none tracking-tighter">//</span>
            <span className="font-black text-slate-900 text-lg tracking-tight">AutoLenis</span>
          </div>
          <div className="hidden md:flex items-center gap-7">
            {["How It Works", "Why AutoLenis", "Reviews", "About Us", "FAQs"].map((l) => (
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
              className="hidden sm:inline text-sm text-slate-600 hover:text-slate-900 transition-colors"
            >
              Log In
            </button>
            <button
              onClick={scrollToForm}
              className="bg-[#0B5FD1] hover:bg-[#0944a8] text-white text-sm font-semibold px-5 py-2 rounded-full transition-colors"
            >
              Start Your Request
            </button>
          </div>
        </div>
      </nav>

      <main className="bg-white text-slate-900 pb-24 lg:pb-0">
        {/* ── SECTION 2: HERO ──────────────────────────────────────────────── */}
        <section className="min-h-screen flex items-center pt-20 pb-16 bg-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-bl from-blue-50/70 to-transparent pointer-events-none" />
          <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-12 items-center relative z-10 w-full">
            {/* LEFT COLUMN */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1] mb-4">
                BUYER-FIRST AUTOMOTIVE CONCIERGE
              </p>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight text-slate-900 leading-[1.05] mb-5">
                {headline}
              </h1>
              <p className="text-lg text-slate-500 leading-relaxed max-w-lg mb-8">
                {subheadline}
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                <button
                  onClick={scrollToForm}
                  data-testid="lp-hero-cta"
                  className="inline-flex items-center gap-2 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-semibold text-sm px-6 py-3 rounded-lg shadow-lg transition-colors"
                >
                  Start Your Vehicle Request <ArrowRight size={16} />
                </button>
                <button
                  onClick={scrollToForm}
                  className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 font-medium text-sm px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  See How AutoLenis Works
                </button>
              </div>
              <div className="flex flex-wrap gap-4 mt-4">
                {[
                  "No dealership pressure",
                  "Compare offers privately",
                  "Concierge-guided",
                  "Secure & transparent",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <CheckCircle2 size={13} className="text-[#0B5FD1]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN — dark navy live-auction dashboard panel */}
            <div className="relative">
              <div className="absolute -inset-6 bg-[#0B5FD1]/20 blur-3xl rounded-[2.5rem] pointer-events-none" />
              <div className="relative bg-[#0F172A] rounded-3xl shadow-2xl border border-white/10 p-3 flex gap-3">
                {/* sidebar nav mockup */}
                <div className="hidden sm:flex flex-col gap-1 w-32 py-2 shrink-0">
                  {[
                    { icon: <ClipboardList size={13} />,    label: "Your Request", active: false },
                    { icon: <LayoutDashboard size={13} />,  label: "Overview",     active: false },
                    { icon: <Gavel size={13} />,            label: "Offers",       active: true  },
                    { icon: <MessageSquare size={13} />,    label: "Messages",     active: false },
                    { icon: <FileText size={13} />,         label: "Documents",    active: false },
                    { icon: <Activity size={13} />,         label: "Activity",     active: false },
                  ].map((n) => (
                    <div
                      key={n.label}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${
                        n.active ? "bg-[#0B5FD1] text-white font-semibold" : "text-slate-400"
                      }`}
                    >
                      {n.icon}
                      {n.label}
                    </div>
                  ))}
                </div>

                {/* main content */}
                <div className="flex-1 bg-white rounded-2xl p-4 min-w-0">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[10px] text-slate-500">Your Request</p>
                      <p className="font-bold text-slate-900 text-sm">2024 BMW X5 xDrive40i</p>
                      <button onClick={scrollToForm} className="text-[10px] text-[#0B5FD1] font-semibold">
                        Edit Request
                      </button>
                    </div>
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                      Active Auction
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-2.5 mb-3 text-center">
                    <p className="text-[9px] text-slate-400 mb-0.5">Auction ends in</p>
                    <p className="text-xl font-bold font-mono text-slate-900 tracking-tight">23 : 47 : 18</p>
                  </div>
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Top Offers
                  </p>
                  {[
                    { rank: 1, name: "Prestige Motors",   city: "Dallas, TX",  price: "$53,420", best: true  },
                    { rank: 2, name: "Summit Auto Group", city: "Plano, TX",   price: "$52,380", best: false },
                    { rank: 3, name: "DriveOne Autos",    city: "Frisco, TX",  price: "$49,950", best: false },
                  ].map((o) => (
                    <div
                      key={o.rank}
                      className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-[#0B5FD1]/10 text-[#0B5FD1] text-[10px] font-bold flex items-center justify-center shrink-0">
                          {o.rank}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-slate-800 truncate">{o.name}</p>
                          <p className="text-[9px] text-slate-400">{o.city}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-bold ${o.best ? "text-green-600" : "text-slate-700"}`}>
                          {o.price}
                        </p>
                        {o.best && (
                          <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">
                            Best Offer
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="bg-blue-50 rounded-xl p-2.5">
                      <p className="text-[9px] text-slate-500">Estimated Savings</p>
                      <p className="text-lg font-bold font-mono text-[#0B5FD1]">$2,341</p>
                      <svg viewBox="0 0 100 24" className="w-full h-5 text-[#0B5FD1] mt-0.5" fill="none" preserveAspectRatio="none">
                        <polyline
                          points="0,20 20,16 35,18 55,9 72,11 100,2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <p className="text-[9px] text-slate-400">vs. market avg</p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-2.5">
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full">
                        <Shield size={8} /> PROTECTED
                      </span>
                      <p className="text-[10px] font-bold text-slate-800 mt-1.5">Contract Shield™</p>
                      <p className="text-[9px] text-[#0B5FD1] font-medium">Review key highlights before you buy.</p>
                    </div>
                  </div>
                </div>
              </div>
              {/* SUV silhouette placeholder peeking below the panel */}
              <div className="absolute -bottom-7 right-2 w-48 h-16 pointer-events-none">
                <Car className="w-full h-full text-slate-900" strokeWidth={1} />
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 3: FORM (immediately below hero) ─────────────────────── */}
        <section
          ref={formRef}
          className="py-16 bg-[#F8FAFC]"
          id="request"
        >
          <div className="max-w-lg mx-auto px-5">
            <div className="text-center mb-8">
              <p className="text-[11px] font-bold text-[#0B5FD1] uppercase tracking-[0.2em] mb-2">
                START YOUR DEALER AUCTION
              </p>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 mb-2 tracking-tight">
                Tell us what you&rsquo;re looking for.
              </h2>
              <p className="text-sm text-slate-500 mb-5">
                Step {formStep + 1} of 2 · Takes about 60 seconds.
              </p>
              <div className="flex items-center justify-center gap-4 flex-wrap text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><Lock size={12} className="text-[#0B5FD1]" /> 100% Secure</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-[#0B5FD1]" /> No Credit Impact</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-[#0B5FD1]" /> No Obligation</span>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl"
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
                    className="w-full bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-[#0B5FD1]/20 flex items-center justify-center gap-2 transition-colors"
                  >
                    Continue <ArrowRight size={18} />
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
                      className="flex-1 bg-[#0B5FD1] hover:bg-[#0944a8] text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-[#0B5FD1]/20 flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                    >
                      {submitting ? "Submitting…" : <>Activate Dealer Auction <ArrowRight size={18} /></>}
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
        <section className="bg-white border-y border-slate-200 py-6">
          <div className="max-w-5xl mx-auto px-5 grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { icon: <DollarSign size={18} />, number: "Thousands", label: "In Reported Buyer Savings" },
              { icon: <Users size={18} />,      number: "500+",      label: "Dealer Partners"           },
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

        {/* ── SECTION 5: TRUST BAR ─────────────────────────────────────────── */}
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

        {/* ── SECTION 6: PROBLEM ───────────────────────────────────────────── */}
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
            <div className="relative rounded-2xl overflow-hidden bg-slate-800 h-80">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700" />
              <div className="absolute top-4 left-4 flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-wider">
                <Car size={14} /> DEALERSHIP
              </div>
              {/* floating buyer-doubt bubbles */}
              <div className="absolute top-8 right-5 bg-white rounded-xl shadow-sm px-3 py-2 text-xs text-slate-700 max-w-[60%]">
                Why is the price different online?
              </div>
              <div className="absolute top-28 left-5 bg-white rounded-xl shadow-sm px-3 py-2 text-xs text-slate-700 max-w-[55%]">
                Are there hidden fees?
              </div>
              <div className="absolute bottom-24 right-6 bg-white rounded-xl shadow-sm px-3 py-2 text-xs text-slate-700 max-w-[55%]">
                Am I getting a fair deal?
              </div>
              <div className="absolute bottom-6 left-6 bg-white rounded-xl shadow-sm px-3 py-2 text-xs text-slate-700 max-w-[60%]">
                This is taking all my time…
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 7: SOLUTION ──────────────────────────────────────────── */}
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

            {/* RIGHT — phone mockup + benefit cards */}
            <div className="flex items-center gap-5">
              <div className="bg-slate-900 rounded-[2rem] p-2 shadow-2xl shrink-0 w-44">
                <div className="bg-white rounded-[1.6rem] overflow-hidden">
                  <div className="h-5 bg-white flex items-center justify-center">
                    <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                  </div>
                  <div className="px-3 pb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Your Offers
                    </p>
                    {[
                      { rank: 1, name: "Prestige Motors",  price: "$53,420", best: true  },
                      { rank: 2, name: "Summit Auto Group", price: "$52,380", best: false },
                      { rank: 3, name: "DriveOne Autos",    price: "$49,950", best: false },
                    ].map((o) => (
                      <div
                        key={o.rank}
                        className={`flex items-center justify-between py-2 border-b border-slate-100 last:border-0 ${o.best ? "bg-blue-50 -mx-1 px-1 rounded-lg" : ""}`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-4 h-4 rounded-full bg-[#0B5FD1]/10 text-[#0B5FD1] text-[9px] font-bold flex items-center justify-center shrink-0">
                            {o.rank}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-800 truncate">{o.name}</span>
                        </div>
                        <span className={`text-[11px] font-bold shrink-0 ${o.best ? "text-[#0B5FD1]" : "text-slate-600"}`}>
                          {o.price}
                        </span>
                      </div>
                    ))}
                    <button onClick={scrollToForm} className="text-[10px] text-[#0B5FD1] font-semibold mt-2">
                      View All Offers
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4 flex-1">
                {[
                  {
                    icon: <BarChart2 size={18} />,
                    title: "Dealers Compete, You Win",
                    body: "Compare offers side-by-side.",
                  },
                  {
                    icon: <CheckCircle2 size={18} />,
                    title: "You're in Control",
                    body: "Choose the best deal on your terms.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex items-start gap-3"
                  >
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-[#0B5FD1] shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 8: HOW IT WORKS ──────────────────────────────────────── */}
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
            <div className="flex flex-col lg:flex-row gap-4 lg:gap-3">
              {[
                {
                  n: 1,
                  icon: <Car size={22} />,
                  title: "Tell Us What You Want",
                  body: "Choose your preferred vehicle, budget, trade-in, and buying preferences.",
                },
                {
                  n: 2,
                  icon: <Users size={22} />,
                  title: "Dealers Compete Privately",
                  body: "Verified dealers submit competing offers through the AutoLenis marketplace.",
                },
                {
                  n: 3,
                  icon: <Tag size={22} />,
                  title: "Compare Real Offers",
                  body: "Review side-by-side pricing, financing, warranties, and dealer terms.",
                },
                {
                  n: 4,
                  icon: <CheckCircle2 size={22} />,
                  title: "Select the Best Deal",
                  body: "Choose the offer you want and complete the process confidently.",
                },
              ].map((s, i) => (
                <div key={s.n} className="relative flex-1">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center h-full">
                    <div className="w-8 h-8 rounded-full bg-[#0B5FD1] text-white text-sm font-black flex items-center justify-center mx-auto mb-3">
                      {s.n}
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-[#0B5FD1] mx-auto mb-3">
                      {s.icon}
                    </div>
                    <p className="font-bold text-slate-900 text-sm mb-2">{s.title}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">{s.body}</p>
                  </div>
                  {i < 3 && (
                    <div className="hidden lg:block absolute top-1/2 -right-3 z-10 -translate-y-1/2 w-6 border-t-2 border-dashed border-slate-300" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 9: WHY BUYERS LOVE AUTOLENIS ─────────────────────────── */}
        <section className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-12">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0B5FD1]">
                WHY BUYERS LOVE AUTOLENIS
              </p>
            </div>
            <div className="grid lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-8 grid grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    icon: <Crown size={20} />,
                    title: "Stay in Control",
                    body: "No pressure. No dealership manipulation.",
                  },
                  {
                    icon: <Clock size={20} />,
                    title: "Save Time",
                    body: "Avoid spending weekends dealership hopping.",
                  },
                  {
                    icon: <Scale size={20} />,
                    title: "Compare Transparently",
                    body: "Review multiple dealer offers side-by-side.",
                  },
                  {
                    icon: <Target size={20} />,
                    title: "Concierge Guidance",
                    body: "We guide you from request to delivery.",
                  },
                  {
                    icon: <Brain size={20} />,
                    title: "Smarter Buying",
                    body: "Make informed decisions without rushed sales tactics.",
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

              {/* Contract Shield report preview */}
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl shadow-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] text-slate-400">Contract Shield™ Report</p>
                    <p className="text-sm font-bold text-slate-900">Dealer Offer Review</p>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-green-100 border border-green-200 flex items-center justify-center text-green-600 text-sm font-black">
                    A
                  </div>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Key Highlights
                </p>
                <div className="space-y-2 mb-4">
                  {[
                    "No hidden fees detected",
                    "Financing terms look good",
                    "Optionals are standard market rate",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                      <span className="text-xs text-slate-600">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 mb-0.5">Overall Assessment</p>
                  <p className="text-green-600 font-bold text-sm">Low Risk</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    This offer is transparent and buyer-friendly.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 10: CONTRACT SHIELD ──────────────────────────────────── */}
        <section className="bg-[#0F172A] py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B5FD1]/10 to-transparent pointer-events-none" />
          <div className="max-w-5xl mx-auto px-5 grid lg:grid-cols-2 gap-12 items-center relative z-10">
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
              <div className="space-y-3 mb-7">
                {[
                  "Increased transparency",
                  "Better contract awareness",
                  "Reduced surprise costs",
                  "More informed purchasing decisions",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 size={16} className="text-blue-400 shrink-0" />
                    <span className="text-sm text-slate-300">{item}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={scrollToForm}
                className="inline-flex items-center gap-2 border border-blue-400/60 text-blue-300 hover:bg-blue-400/10 font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
              >
                Learn More About Contract Shield™ <ArrowRight size={16} />
              </button>
            </div>

            {/* Large glowing shield */}
            <div className="flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-[#0B5FD1]/40 blur-3xl rounded-full pointer-events-none" />
                <div className="relative w-44 h-44 rounded-3xl bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] flex items-center justify-center shadow-2xl shadow-[#0B5FD1]/40 border border-blue-400/30">
                  <ShieldCheck size={88} className="text-white" strokeWidth={1.5} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 11: COMPARISON TABLE ─────────────────────────────────── */}
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

        {/* ── SECTION 12: SOCIAL PROOF ─────────────────────────────────────── */}
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
          </div>
        </section>

        {/* ── SECTION 13: FAQ ──────────────────────────────────────────────── */}
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
                  <p className="text-sm text-slate-400 hover:text-white mb-2 cursor-pointer transition-colors">
                    DMCA
                  </p>
                  <p className="text-sm text-slate-400 hover:text-white mb-2 cursor-pointer transition-colors">
                    Sitemap
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Contact
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                    <Phone size={13} className="shrink-0" /> (888) 987-0123
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
            $99 refundable deposit · No obligation · 48-hour auction
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

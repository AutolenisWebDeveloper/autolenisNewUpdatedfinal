"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
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
      <main className="bg-white text-slate-900 pb-24 lg:pb-0">
        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <section className="bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] text-white px-5 pt-14 pb-12 text-center">
          <div className="max-w-3xl mx-auto">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-200/80 mb-4">
              AutoLenis · Private Dealer Auction
            </p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-[1.05] mb-4 tracking-tight">
              {headline}
            </h1>
            <p className="text-lg sm:text-xl text-blue-100 mb-3 max-w-xl mx-auto leading-relaxed font-medium">
              {subheadline}
            </p>
            <p className="text-sm text-blue-200/80 mb-8 max-w-md mx-auto">
              Compare every offer side-by-side. Choose on your terms.
            </p>
            <button
              onClick={scrollToForm}
              data-testid="lp-hero-cta"
              className="inline-flex items-center gap-2 bg-white text-[#0B5FD1] font-black text-base px-7 py-4 rounded-2xl shadow-lg hover:bg-blue-50 transition-colors"
            >
              Start My Dealer Auction <ArrowRight size={18} />
            </button>
            <p className="text-[11px] text-blue-200/70 mt-4">
              Built for buyers who refuse to negotiate alone
            </p>
          </div>
        </section>

        {/* ── OPERATIONAL CREDIBILITY STRIP (Part 10) ────────────────────── */}
        <section
          className="bg-white border-b border-slate-100 py-8 px-5"
          id="credibility"
        >
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-5">
              Platform Infrastructure
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: <Lock size={18} />,       title: "Stripe-Secured",         body: "PCI-DSS Level 1 payments" },
                { icon: <FileText size={18} />,   title: "DocuSign eSignature",    body: "Audit-trail enforced contracts" },
                { icon: <UserCheck size={18} />,  title: "Verified Dealer Network", body: "Manual vetting — every dealer" },
                { icon: <Shield size={18} />,     title: "Encrypted Buyer Portal", body: "AES-256 sensitive data" },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex flex-col items-center text-center bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4"
                >
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-[#0B5FD1] mb-2">
                    {item.icon}
                  </div>
                  <p className="text-xs font-bold text-slate-800">{item.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── VIDEO / VSL placeholder ────────────────────────────────────── */}
        <section className="py-14 px-5 bg-slate-50">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-xs font-bold text-[#0B5FD1] uppercase tracking-widest mb-2">
              90 seconds — how it works
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-5 tracking-tight">
              See the platform in action
            </h2>
            <div className="aspect-video bg-slate-200 rounded-2xl overflow-hidden border border-slate-300 flex items-center justify-center">
              {/* Replace [VIDEO_ID] once the VSL is published per /docs/vsl-script-outline.md */}
              <p className="text-slate-500 text-sm font-medium">VSL placeholder — see /docs/vsl-script-outline.md</p>
            </div>
          </div>
        </section>

        {/* ── BEFORE / AFTER ─────────────────────────────────────────────── */}
        <section className="py-16 px-5 bg-white">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">
                Two ways to buy a car
              </h2>
              <p className="text-slate-500 max-w-xl mx-auto">
                Buyers report saving thousands by letting dealers compete instead of negotiating alone.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <div className="rounded-2xl border-2 border-red-100 bg-red-50/40 p-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-600 mb-3">
                  The old way
                </p>
                <ul className="space-y-2.5 text-sm text-slate-700">
                  {[
                    "Drive lot-to-lot. Lose a Saturday.",
                    "Sit across the desk from one salesperson.",
                    "Negotiate alone, against trained pros.",
                    "Wonder if the dealer down the road would have done better.",
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <X size={16} className="text-red-500 shrink-0 mt-0.5" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 pt-4 border-t border-red-100 text-xs text-slate-500">
                  Leverage: <strong>You vs. one dealer</strong>
                </p>
              </div>
              <div className="rounded-2xl border-2 border-[#0B5FD1] bg-blue-50/40 p-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B5FD1] mb-3">
                  The AutoLenis way
                </p>
                <ul className="space-y-2.5 text-sm text-slate-700">
                  {[
                    "Submit one request from home.",
                    "Up to 8 verified dealers compete in a 48-hour auction.",
                    "Compare ranked offers side-by-side — cash, monthly, overall.",
                    "Choose the best offer. Or decline all and walk away.",
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <CheckCircle2 size={16} className="text-[#0B5FD1] shrink-0 mt-0.5" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 pt-4 border-t border-blue-100 text-xs text-slate-500">
                  Leverage: <strong>Multiple dealers vs. you</strong>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── LIVE INTERFACE PREVIEW (Part 12) ───────────────────────────── */}
        <section
          className="py-16 px-5 bg-slate-50 border-y border-slate-100"
          id="platform-preview"
        >
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-xs font-bold text-[#0B5FD1] uppercase tracking-widest mb-2">
                The AutoLenis Platform
              </p>
              <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">
                This Is What Negotiating Leverage Looks Like
              </h2>
              <p className="text-slate-500 max-w-xl mx-auto">
                Real buyer interface. Real dealer competition. Real offer comparison — engineered for buyer-side leverage.
              </p>
            </div>
            <div className="grid lg:grid-cols-5 gap-5">
              {/* Live auction card */}
              <div className="lg:col-span-2 bg-gradient-to-br from-[#0B5FD1] to-[#0944a8] rounded-2xl p-6 text-white shadow-xl">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                    Your Auction Is Live
                  </span>
                </div>
                <div className="text-center mb-6">
                  <p className="text-4xl font-bold font-mono tracking-tight">23:47:12</p>
                  <p className="text-xs text-white/60 mt-1">remaining</p>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white/10 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold">6</p>
                    <p className="text-[10px] text-white/60 mt-0.5">Offers submitted</p>
                  </div>
                  <div className="bg-white/10 rounded-xl p-3 text-center">
                    <p className="text-sm font-bold">High</p>
                    <p className="text-[10px] text-white/60">Dealer interest</p>
                  </div>
                </div>
                <div className="bg-white/10 rounded-xl px-3 py-2 mb-3 text-center">
                  <p className="text-[11px] text-white/80 font-medium">2 dealers actively revising offers</p>
                </div>
                <div className="bg-white/10 rounded-xl p-3 text-xs text-white/75">
                  <p className="font-semibold text-white mb-1">What happens next</p>
                  <p>When your auction closes, you choose from ranked offers — Best Cash, Best Monthly, Best Overall.</p>
                </div>
                <p className="text-[9px] text-white/40 text-right mt-2">Updates every 30s</p>
              </div>
              {/* Ranked offers */}
              <div className="lg:col-span-3 space-y-3">
                {[
                  {
                    rank: "BEST OVERALL",
                    color: "border-[#0B5FD1] bg-[#0B5FD1]/5",
                    badge: "bg-[#0B5FD1] text-white",
                    otd: "$47,820", monthly: "$612 / mo", term: "72 mo · 6.4% APR",
                    tag: "Anonymized Dealer A",
                    note: "Lowest junk fees · Pre-approved financing",
                  },
                  {
                    rank: "BEST CASH",
                    color: "border-green-200 bg-green-50",
                    badge: "bg-green-600 text-white",
                    otd: "$46,940", monthly: "—", term: "Cash purchase",
                    tag: "Anonymized Dealer C",
                    note: "Cash-OTD price · No financing tied",
                  },
                  {
                    rank: "BEST MONTHLY",
                    color: "border-blue-200 bg-blue-50",
                    badge: "bg-blue-600 text-white",
                    otd: "$48,210", monthly: "$579 / mo", term: "84 mo · 5.9% APR",
                    tag: "Anonymized Dealer B",
                    note: "Lowest monthly payment · Extended term",
                  },
                ].map((o) => (
                  <div key={o.rank} className={`rounded-2xl border-2 ${o.color} p-4`}>
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${o.badge}`}
                      >
                        {o.rank}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">{o.tag}</span>
                    </div>
                    <div className="flex items-baseline justify-between mb-1">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Out-the-door</p>
                        <p className="text-2xl font-bold text-slate-900 font-mono">{o.otd}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Monthly</p>
                        <p className="text-lg font-bold text-slate-700 font-mono">{o.monthly}</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-2">{o.term}</p>
                    <p className="text-xs text-slate-600 border-t border-slate-200/60 pt-2 leading-snug">{o.note}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-10 grid sm:grid-cols-3 gap-3 text-center">
              {[
                { num: "Up to 8",   label: "Verified dealers per auction" },
                { num: "48 hrs",    label: "Competitive bid window" },
                { num: "Anonymized", label: "Dealer identity until you choose" },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                  <p className="text-xl font-black text-[#0B5FD1] font-mono">{s.num}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-6 italic">
              Interface preview · Sample data for illustration · Actual offers vary by market and vehicle
            </p>
          </div>
        </section>

        {/* ── SOCIAL PROOF / STATS ───────────────────────────────────────── */}
        <section className="py-16 px-5 bg-white" id="proof">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">
                Buyers who let dealers compete for them
              </h2>
              <p className="text-slate-500 max-w-xl mx-auto">
                Verified buyer experiences from across the country.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 mb-12">
              {TESTIMONIALS.map((t) => (
                <div
                  key={`${t.name}-${t.location}`}
                  className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col"
                >
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: t.stars }).map((_, i) => (
                      <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed flex-1">&ldquo;{t.quote}&rdquo;</p>
                  <div className="mt-4 pt-3 border-t border-slate-200">
                    <p className="text-sm font-bold text-slate-800">{t.name}</p>
                    <p className="text-xs text-slate-500">{t.location} · {t.vehicle}</p>
                    {t.saved && (
                      <p className="text-xs font-bold text-green-600 mt-0.5">Saved {t.saved}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 max-w-3xl mx-auto">
              {[
                { number: "Thousands", label: "In reported buyer savings" },
                { number: "Up to 8",   label: "Verified dealers per auction" },
                { number: "48 hrs",    label: "Auction window" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-center"
                >
                  <p className="text-2xl font-black text-[#0B5FD1] font-mono">{s.number}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── LEAD FORM ──────────────────────────────────────────────────── */}
        <section
          ref={formRef}
          className="py-16 px-5 bg-gradient-to-b from-slate-50 to-white"
          id="request"
        >
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-8">
              <p className="text-xs font-bold text-[#0B5FD1] uppercase tracking-widest mb-2">
                Start Your Dealer Auction
              </p>
              <h2 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">
                Tell us what you&rsquo;re looking for
              </h2>
              <p className="text-sm text-slate-500">
                Step {formStep + 1} of 2 · Takes about 60 seconds.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
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

        {/* ── FAQ ────────────────────────────────────────────────────────── */}
        <section className="py-16 px-5 bg-white border-t border-slate-100" id="faq">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-slate-900 text-center mb-8 tracking-tight">
              Common questions
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
                  className="group bg-slate-50 border border-slate-200 rounded-xl px-5 py-3"
                  onToggle={(e) => {
                    if ((e.currentTarget as HTMLDetailsElement).open) {
                      trackFunnelEvent("lp_faq_open", { campaign });
                    }
                  }}
                >
                  <summary className="cursor-pointer list-none flex justify-between items-center font-semibold text-slate-800 text-sm py-1.5">
                    {item.q}
                    <span className="text-[#0B5FD1] text-lg group-open:rotate-45 transition-transform">+</span>
                  </summary>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <footer className="bg-slate-900 text-slate-400 py-10 px-5">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between gap-4 text-xs">
            <p>© {new Date().getFullYear()} AutoLenis. All rights reserved.</p>
            <div className="flex gap-4">
              <Link href="/legal/privacy" className="hover:text-white">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-white">Terms</Link>
              <Link href="/contact" className="hover:text-white">Contact</Link>
            </div>
          </div>
        </footer>
      </main>

      {/* ── EXIT INTENT MODAL (desktop only) ──────────────────────────────── */}
      {showExitIntent && !submitted && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-5">
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

      {/* ── MOBILE STICKY CTA (Part 15) ──────────────────────────────────── */}
      {!submitted && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] p-3 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => {
              trackFunnelEvent("lp_sticky_cta_click", { campaign });
              scrollToForm();
            }}
            data-testid="lp-sticky-cta"
            className="w-full bg-[#0B5FD1] text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            Compare Dealer Offers <ArrowRight size={16} />
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1.5 flex items-center justify-center gap-1">
            <Clock size={10} /> $99 refundable deposit · No obligation · 48-hour auction
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

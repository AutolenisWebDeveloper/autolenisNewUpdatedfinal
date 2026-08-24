"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Check, ChevronLeft, Loader2, ArrowRight, X, ShieldCheck,
  RefreshCw, Clock, Upload,
} from "lucide-react";
import { api } from "@/lib/api/client";

// ─── Types & Constants ──────────────────────────────────────────────────────────

type VehicleType = "SUV" | "Sedan" | "Truck" | "Van" | "Coupe" | "Other";
type Condition = "New" | "Used" | "Either";
type Timeline = "ASAP" | "1-2 Weeks" | "1 Month" | "Flexible";
type MileageOption = "25k" | "50k" | "75k" | "100k" | "Any";

type PaymentMethod = "FINANCE_AUTOLENIS" | "FINANCE_OUTSIDE" | "CASH" | "LEASE" | "UNDECIDED";
type PreApprovalStatus = "APPROVED" | "WANTS_HELP" | "SELF_ARRANGE" | "CASH" | "LEASE";
type CreditRange = "EXCELLENT" | "GOOD" | "FAIR" | "BUILDING" | "PREFER_NOT_TO_SAY";
type PurchaseTimeframe = "ASAP" | "WITHIN_7_DAYS" | "WITHIN_30_DAYS" | "WITHIN_60_DAYS_PLUS";

interface FinancingState {
  paymentMethod: PaymentMethod | "";
  preApprovalStatus: PreApprovalStatus | "";
  // APPROVED branch
  lenderName: string;
  approvedAmount: string;
  quotedApr: string;
  approvalExpiresAt: string;
  downPayment: string;
  monthlyPaymentTarget: string;
  preApprovalLetterUrl: string;
  letterUploading: boolean;
  // WANTS_HELP branch
  estimatedCreditRange: CreditRange | "";
  estimatedAnnualIncome: string;
  // CASH branch
  proofOfFundsAvailable: boolean | null;
  maxBudget: string;
  // LEASE branch
  leaseTermMonths: 24 | 36 | 48 | null;
  leaseMilesPerYear: string;
  // Universal
  tradeIn: boolean | null;
  purchaseTimeframe: PurchaseTimeframe | "";
}

interface FormState {
  // Step 1
  vehicleType: VehicleType | "";
  condition: Condition | "";
  makeModel: string;
  timeline: Timeline | "";
  yearMin: number | null;
  yearMax: number | null;
  purchaseTimeframe: PurchaseTimeframe | "";
  // Step 2
  zip: string;
  budget: string;          // formatted with commas
  downPayment: string;
  monthlyTarget: string;
  // Step 3
  trim: string;
  maxMileage: MileageOption;
  features: string[];
  // Step 4 (financing — optional)
  financing: FinancingState | null; // null = skipped
}

const INITIAL_FINANCING: FinancingState = {
  paymentMethod: "",
  preApprovalStatus: "",
  lenderName: "",
  approvedAmount: "",
  quotedApr: "",
  approvalExpiresAt: "",
  downPayment: "",
  monthlyPaymentTarget: "",
  preApprovalLetterUrl: "",
  letterUploading: false,
  estimatedCreditRange: "",
  estimatedAnnualIncome: "",
  proofOfFundsAvailable: null,
  maxBudget: "",
  leaseTermMonths: null,
  leaseMilesPerYear: "",
  tradeIn: null,
  purchaseTimeframe: "",
};

const INITIAL: FormState = {
  vehicleType: "", condition: "", makeModel: "", timeline: "",
  yearMin: null, yearMax: null, purchaseTimeframe: "",
  zip: "", budget: "", downPayment: "", monthlyTarget: "",
  trim: "", maxMileage: "Any", features: [],
  financing: null,
};

const STORAGE_KEY = "request-wizard-v1";

const VEHICLE_TYPES: { id: VehicleType; label: string; icon: string }[] = [
  { id: "SUV",    label: "SUV",    icon: "🚙" },
  { id: "Sedan",  label: "Sedan",  icon: "🚗" },
  { id: "Truck",  label: "Truck",  icon: "🛻" },
  { id: "Van",    label: "Van",    icon: "🚐" },
  { id: "Coupe",  label: "Coupe",  icon: "🏎️" },
  { id: "Other",  label: "Other",  icon: "🚘" },
];

const TIMELINES: Timeline[] = ["ASAP", "1-2 Weeks", "1 Month", "Flexible"];
const CONDITIONS: Condition[] = ["New", "Used", "Either"];
const REQUEST_YEARS = Array.from({ length: 17 }, (_, i) => 2026 - i);
const TIMEFRAMES: { val: PurchaseTimeframe; label: string }[] = [
  { val: "ASAP", label: "ASAP" },
  { val: "WITHIN_7_DAYS", label: "Within 7 days" },
  { val: "WITHIN_30_DAYS", label: "Within 30 days" },
  { val: "WITHIN_60_DAYS_PLUS", label: "60+ days / flexible" },
];
const MILEAGE_STOPS: MileageOption[] = ["25k", "50k", "75k", "100k", "Any"];
const MILEAGE_VALUE: Record<MileageOption, number | undefined> = {
  "25k": 25000, "50k": 50000, "75k": 75000, "100k": 100000, "Any": undefined,
};
const FEATURES = [
  "Sunroof", "Navigation", "Backup Camera", "Heated Seats",
  "Apple CarPlay", "Android Auto", "Blind Spot Monitor", "Lane Assist",
  "Remote Start", "Third Row Seating", "All-Wheel Drive", "Leather Interior",
];

const POPULAR_MODELS = [
  "Toyota Camry", "Toyota RAV4", "Toyota Highlander", "Toyota Tacoma", "Toyota 4Runner",
  "Honda Accord", "Honda Civic", "Honda CR-V", "Honda Pilot", "Honda Odyssey",
  "Ford F-150", "Ford Explorer", "Ford Escape", "Ford Mustang", "Ford Bronco",
  "Chevrolet Silverado", "Chevrolet Equinox", "Chevrolet Tahoe", "Chevrolet Suburban",
  "Nissan Rogue", "Nissan Altima", "Nissan Sentra", "Nissan Pathfinder",
  "Jeep Wrangler", "Jeep Grand Cherokee", "Jeep Cherokee", "Jeep Compass",
  "Tesla Model 3", "Tesla Model Y", "Tesla Model S", "Tesla Model X",
  "BMW 3 Series", "BMW 5 Series", "BMW X3", "BMW X5",
  "Mercedes C-Class", "Mercedes E-Class", "Mercedes GLC", "Mercedes GLE",
  "Subaru Outback", "Subaru Forester", "Subaru Crosstrek",
  "Hyundai Tucson", "Hyundai Santa Fe", "Hyundai Elantra",
  "Kia Sorento", "Kia Telluride", "Kia Sportage",
  "Lexus RX", "Lexus ES", "Lexus NX",
  "Mazda CX-5", "Mazda CX-9", "Mazda3",
  "GMC Sierra", "GMC Yukon", "Acura MDX", "Audi Q5",
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}
function parseCurrency(raw: string): number {
  return Number(raw.replace(/\D/g, "")) || 0;
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function NewRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [success, setSuccess] = useState<{ requestId: string } | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0);

  // ── Hydrate from URL params (Adjust-Request flow) FIRST, then sessionStorage ──
  useEffect(() => {
    const sp = searchParams;
    const fromUrl: Partial<FormState> = {};
    const vt = sp.get("vehicleType");
    if (vt && ["SUV","Sedan","Truck","Van","Coupe","Other"].includes(vt)) fromUrl.vehicleType = vt as VehicleType;
    const cond = sp.get("condition");
    if (cond === "New" || cond === "Used" || cond === "Either") fromUrl.condition = cond;
    const tl = sp.get("timeline");
    if (tl && (TIMELINES as readonly string[]).includes(tl)) fromUrl.timeline = tl as Timeline;
    const ptf = sp.get("purchaseTimeframe");
    if (ptf && TIMEFRAMES.some(t => t.val === ptf)) fromUrl.purchaseTimeframe = ptf as PurchaseTimeframe;
    const yMin = sp.get("yearMin");
    if (yMin && /^\d{4}$/.test(yMin)) fromUrl.yearMin = Number(yMin);
    const yMax = sp.get("yearMax");
    if (yMax && /^\d{4}$/.test(yMax)) fromUrl.yearMax = Number(yMax);
    const make = sp.get("makePreference");
    const model = sp.get("modelPreference");
    if (make || model) fromUrl.makeModel = [make, model].filter(Boolean).join(" ").trim();
    const zip = sp.get("zip");
    if (zip && /^\d{5}$/.test(zip)) fromUrl.zip = zip;
    const maxBudgetCents = sp.get("maxBudgetCents");
    if (maxBudgetCents && /^\d+$/.test(maxBudgetCents)) {
      fromUrl.budget = formatCurrency(String(Math.round(Number(maxBudgetCents) / 100)));
    }
    const features = sp.get("features");
    if (features) fromUrl.features = features.split(",").map(s => s.trim()).filter(Boolean);

    if (Object.keys(fromUrl).length > 0) {
      setForm(prev => ({ ...prev, ...fromUrl }));
      // Don't read sessionStorage when adjusting — start fresh from URL.
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      return;
    }

    // Otherwise, hydrate from sessionStorage as before.
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as { form: FormState; step: 1 | 2 | 3 | 4 };
        if (data?.form) setForm({ ...INITIAL, ...data.form });
        if (data?.step && [1, 2, 3, 4].includes(data.step)) setStep(data.step as 1 | 2 | 3 | 4);
      }
    } catch { /* ignore */ }
  }, [searchParams]);

  // ── Persist form + step ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ form, step }));
    } catch { /* ignore */ }
  }, [form, step]);

  // ── Pre-fill ZIP from the buyer profile (editable; only fills when empty) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ zip?: string }>("/api/buyer/profile");
        const z = data?.zip;
        if (!cancelled && z && /^\d{5}$/.test(z)) {
          // Functional update so we never clobber a ZIP already hydrated from
          // the URL (Adjust-Request flow) or restored from sessionStorage.
          setForm(prev => (prev.zip ? prev : { ...prev, zip: z }));
        }
      } catch { /* ignore — ZIP stays editable/empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Rate limit countdown ──────────────────────────────────────────────────
  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const id = setInterval(() => setRateLimitSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [rateLimitSeconds]);

  // ── Auto-redirect on success ──────────────────────────────────────────────
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => router.push(`/buyer/requests/${success.requestId}`), 5000);
    return () => clearTimeout(t);
  }, [success, router]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }, []);

  // ── Validators ────────────────────────────────────────────────────────────
  function validateStep1(): boolean {
    const e: typeof errors = {};
    if (!form.vehicleType)      e.vehicleType      = "Please select a vehicle type";
    if (!form.condition)        e.condition        = "Select new, used, or either";
    if (!form.timeline)         e.timeline         = "Select your timeline";
    if (!form.purchaseTimeframe) e.purchaseTimeframe = "Select how soon you're buying";
    if (form.yearMin != null && form.yearMax != null && form.yearMin > form.yearMax) {
      e.yearMax = "Max year must be greater than or equal to min year";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function validateStep2(): boolean {
    const e: typeof errors = {};
    if (!form.zip) e.zip = "ZIP code is required";
    else if (!/^\d{5}$/.test(form.zip)) e.zip = "Enter a valid 5-digit ZIP";
    const budget = parseCurrency(form.budget);
    if (!budget) e.budget = "Budget is required";
    else if (budget < 5000) e.budget = "Budget must be greater than $5,000";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep(s => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }
  function back() {
    setStep(s => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit(skipFinancing?: boolean) {
    setError(null);
    setLoading(true);

    // Pack extra metadata into structured notes
    const meta: Record<string, unknown> = {
      vehicleType: form.vehicleType,
      condition: form.condition,
      timeline: form.timeline,
      zip: form.zip || null,
      downPaymentCents: form.downPayment ? parseCurrency(form.downPayment) * 100 : null,
      monthlyTargetCents: form.monthlyTarget ? parseCurrency(form.monthlyTarget) * 100 : null,
      trim: form.trim || null,
      maxMileage: MILEAGE_VALUE[form.maxMileage] ?? null,
      features: form.features,
    };
    const metaLines = [
      `Vehicle Type: ${form.vehicleType}`,
      `Condition: ${form.condition}`,
      `Timeline: ${form.timeline}`,
      form.zip ? `ZIP: ${form.zip}` : null,
      form.downPayment ? `Down Payment: $${form.downPayment}` : null,
      form.monthlyTarget ? `Monthly Target: $${form.monthlyTarget}` : null,
      form.trim ? `Trim: ${form.trim}` : null,
      MILEAGE_VALUE[form.maxMileage] ? `Max Mileage: ${form.maxMileage}` : null,
      form.features.length ? `Must-Have: ${form.features.join(", ")}` : null,
    ].filter(Boolean).join("\n");
    const notes = metaLines + "\n\n<!--META:" + JSON.stringify(meta) + "-->";

    // Parse make/model
    const mmTrim = form.makeModel.trim();
    let makePreference: string | undefined;
    let modelPreference: string | undefined;
    if (mmTrim) {
      const parts = mmTrim.split(/\s+/);
      makePreference = parts[0];
      modelPreference = parts.slice(1).join(" ") || undefined;
    }

    // Build financing payload (null if skipped or not filled)
    let financingPayload: Record<string, unknown> | undefined;
    const fin = form.financing;
    if (!skipFinancing && fin && fin.paymentMethod) {
      financingPayload = {
        paymentMethod: fin.paymentMethod || undefined,
        preApprovalStatus: fin.preApprovalStatus || undefined,
        purchaseTimeframe: fin.purchaseTimeframe || undefined,
        tradeIn: fin.tradeIn ?? undefined,
      };
      if (fin.preApprovalStatus === "APPROVED") {
        if (fin.lenderName) financingPayload.lenderName = fin.lenderName;
        if (fin.approvedAmount) financingPayload.approvedAmountCents = parseCurrency(fin.approvedAmount) * 100;
        if (fin.quotedApr) financingPayload.quotedApr = parseFloat(fin.quotedApr);
        if (fin.approvalExpiresAt) financingPayload.approvalExpiresAt = new Date(fin.approvalExpiresAt).toISOString();
        if (fin.downPayment) financingPayload.downPaymentCents = parseCurrency(fin.downPayment) * 100;
        if (fin.monthlyPaymentTarget) financingPayload.monthlyPaymentTargetCents = parseCurrency(fin.monthlyPaymentTarget) * 100;
        if (fin.preApprovalLetterUrl) financingPayload.preApprovalLetterUrl = fin.preApprovalLetterUrl;
      } else if (fin.preApprovalStatus === "WANTS_HELP") {
        if (fin.estimatedCreditRange) financingPayload.estimatedCreditRange = fin.estimatedCreditRange;
        if (fin.estimatedAnnualIncome) financingPayload.estimatedAnnualIncomeCents = parseCurrency(fin.estimatedAnnualIncome) * 100;
        if (fin.downPayment) financingPayload.downPaymentCents = parseCurrency(fin.downPayment) * 100;
        if (fin.monthlyPaymentTarget) financingPayload.monthlyPaymentTargetCents = parseCurrency(fin.monthlyPaymentTarget) * 100;
      } else if (fin.preApprovalStatus === "CASH") {
        if (fin.proofOfFundsAvailable !== null) financingPayload.proofOfFundsAvailable = fin.proofOfFundsAvailable;
        if (fin.maxBudget) financingPayload.maxBudgetCents = parseCurrency(fin.maxBudget) * 100;
      } else if (fin.preApprovalStatus === "LEASE") {
        if (fin.leaseTermMonths) financingPayload.leaseTermMonths = fin.leaseTermMonths;
        if (fin.leaseMilesPerYear) financingPayload.leaseMilesPerYear = parseInt(fin.leaseMilesPerYear, 10);
        if (fin.downPayment) financingPayload.downPaymentCents = parseCurrency(fin.downPayment) * 100;
      }
    }

    const payload: Record<string, unknown> = {
      makePreference,
      modelPreference,
      maxBudgetCents: parseCurrency(form.budget) * 100,
      // Structured intake fields (Phase 5.3-B) — sent first-class so the
      // unified intake service / lead scoring sees complete data instead of
      // having to parse them back out of the notes blob.
      yearMin: form.yearMin,
      yearMax: form.yearMax,
      vehicleType: form.vehicleType || undefined,
      condition: form.condition || undefined,
      zip: form.zip || undefined,
      purchaseTimeframe: form.purchaseTimeframe || undefined,
      notes,
    };
    if (financingPayload) payload.financing = financingPayload;

    try {
      const res = await fetch("/api/buyer/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as {
        success?: boolean;
        data?: { request: { id: string } };
        error?: { code?: string; message: string };
      };

      if (res.status === 401) {
        sessionStorage.removeItem(STORAGE_KEY);
        router.push("/auth/signin?redirect=/buyer/requests/new");
        return;
      }
      if (res.status === 429) {
        setError(data.error?.message ?? "You've already submitted 3 requests today. Please wait before submitting another.");
        setRateLimitSeconds(60 * 60);
        return;
      }
      if (!res.ok || !data.success || !data.data?.request?.id) {
        setError(data.error?.message ?? "Something went wrong. Please try again.");
        return;
      }

      // Success
      sessionStorage.removeItem(STORAGE_KEY);
      setSuccess({ requestId: data.data.request.id });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) return <SuccessState requestId={success.requestId} />;

  return (
    <div className="min-h-full bg-[#FBFAFE]" data-testid="new-request-page">
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-10">
        <ProgressBar step={step} />

        <div className="mt-8" key={step}>
          {step === 1 && (
            <Step1
              form={form}
              errors={errors}
              update={update}
              onNext={next}
            />
          )}
          {step === 2 && (
            <Step2
              form={form}
              errors={errors}
              update={update}
              onNext={next}
              onBack={back}
            />
          )}
          {step === 3 && (
            <Step3
              form={form}
              update={update}
              onBack={back}
              onNext={next}
            />
          )}
          {step === 4 && (
            <Step4
              financing={form.financing ?? INITIAL_FINANCING}
              onUpdate={(fin) => setForm(prev => ({ ...prev, financing: fin }))}
              onBack={back}
              onSubmit={() => submit(false)}
              onSkip={() => { setForm(prev => ({ ...prev, financing: null })); submit(true); }}
              loading={loading}
              error={error}
              rateLimitSeconds={rateLimitSeconds}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Progress Bar ───────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ["What you want", "Your budget", "Preferences", "Financing"];
  return (
    <div data-testid="wizard-progress" className="mb-2">
      {/* Mobile: text + thin line */}
      <div className="sm:hidden">
        <p className="text-xs font-semibold text-al-primary mb-2" data-testid="wizard-step-text">
          Step {step} of 4 · {labels[step - 1]}
        </p>
        <div className="h-1.5 w-full bg-[#E5E7EB] rounded-full overflow-hidden">
          <div
            className="h-full bg-al-primary transition-all duration-500 ease-out"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
      </div>
      {/* Desktop: pill steps */}
      <div className="hidden sm:flex items-center justify-between gap-3">
        {[1, 2, 3, 4].map((n, i) => {
          const isCurrent = step === n;
          const isComplete = step > n;
          const labelColor =
            isCurrent ? "text-al-primary" :
            isComplete ? "text-[#1A6B18]" :
            "text-slate-400";
          const dotBg =
            isCurrent ? "bg-al-primary text-white" :
            isComplete ? "bg-[#50D14E] text-white" :
            "bg-slate-200 text-slate-500";
          const ring = isCurrent ? "ring-4 ring-al-primary/15" : "";
          return (
            <div key={n} className="flex-1 flex items-center gap-2.5" data-testid={`progress-step-${n}`}>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${dotBg} ${ring}`}>
                {isComplete ? <Check size={14} /> : n}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold uppercase tracking-wider ${labelColor}`}>Step {n}</p>
                <p className="text-sm font-medium text-slate-800 truncate">{labels[i]}</p>
              </div>
              {i < 3 && (
                <div className={`hidden md:block flex-1 h-0.5 mx-1 transition-colors ${
                  step > n ? "bg-[#50D14E]" : "bg-slate-200"
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 1 ─────────────────────────────────────────────────────────────────────

function Step1({
  form, errors, update, onNext,
}: {
  form: FormState;
  errors: Partial<Record<keyof FormState, string>>;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onNext: () => void;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = form.makeModel.trim().length >= 1
    ? POPULAR_MODELS.filter(m => m.toLowerCase().includes(form.makeModel.toLowerCase())).slice(0, 6)
    : [];

  return (
    <section data-testid="wizard-step-1" className="animate-fadein">
      <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">Tell us what you want</h1>
      <p className="text-sm text-slate-600 mt-1.5 mb-7">
        We&apos;ll search for the best options and have dealers compete for your business.
      </p>

      {/* Vehicle type */}
      <FieldGroup label="Vehicle Type" testId="field-vehicle-type" error={errors.vehicleType}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {VEHICLE_TYPES.map(({ id, label, icon }) => {
            const selected = form.vehicleType === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => update("vehicleType", id)}
                data-testid={`vehicle-type-${id.toLowerCase()}`}
                className={`relative rounded-xl border-2 px-4 py-4 text-left transition-all hover:-translate-y-0.5 ${
                  selected
                    ? "border-al-primary bg-al-primary-subtle shadow-sm shadow-al-primary/15"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {selected && (
                  <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-al-primary text-white flex items-center justify-center">
                    <Check size={12} />
                  </span>
                )}
                <span className="text-2xl block mb-1.5" aria-hidden>{icon}</span>
                <span className={`text-sm font-semibold ${selected ? "text-al-primary" : "text-slate-800"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* New / Used / Either */}
      <FieldGroup label="New or Used" testId="field-condition" error={errors.condition}>
        <div className="grid grid-cols-3 gap-3">
          {CONDITIONS.map(opt => {
            const selected = form.condition === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => update("condition", opt)}
                data-testid={`condition-${opt.toLowerCase()}`}
                className={`rounded-xl border-2 px-4 py-3.5 font-semibold text-sm transition-all ${
                  selected
                    ? "bg-al-primary text-white border-al-primary shadow-sm shadow-al-primary/20"
                    : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* Make/Model */}
      <FieldGroup label="Make / Model Preference" testId="field-make-model" optional>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={form.makeModel}
            onChange={(e) => { update("makeModel", e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="e.g. Toyota Camry, Honda CR-V, Ford F-150"
            data-testid="make-model-input"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul
              data-testid="make-model-suggestions"
              className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto"
            >
              {suggestions.map(s => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); update("makeModel", s); setShowSuggestions(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-al-primary-subtle hover:text-al-primary"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FieldGroup>

      {/* Year range */}
      <FieldGroup label="Year Range" testId="field-year-range" optional error={errors.yearMax}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="block text-xs text-slate-500 mb-1.5">Min year</span>
            <select
              value={form.yearMin ?? ""}
              onChange={(e) => update("yearMin", e.target.value ? Number(e.target.value) : null)}
              data-testid="year-min-select"
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
            >
              <option value="">No minimum</option>
              {REQUEST_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <span className="block text-xs text-slate-500 mb-1.5">Max year</span>
            <select
              value={form.yearMax ?? ""}
              onChange={(e) => update("yearMax", e.target.value ? Number(e.target.value) : null)}
              data-testid="year-max-select"
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
            >
              <option value="">No maximum</option>
              {REQUEST_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </FieldGroup>

      {/* Timeline */}
      <FieldGroup label="Timeline" testId="field-timeline" error={errors.timeline}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {TIMELINES.map(t => {
            const selected = form.timeline === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => update("timeline", t)}
                data-testid={`timeline-${t.toLowerCase().replace(/\s+/g, "-")}`}
                className={`rounded-full border px-4 py-2.5 text-sm font-medium transition-all ${
                  selected
                    ? "bg-al-primary text-white border-al-primary"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* Purchase timeframe — how soon are you buying? (drives lead scoring) */}
      <FieldGroup label="How soon are you looking to buy?" testId="field-purchase-timeframe" error={errors.purchaseTimeframe}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {TIMEFRAMES.map(tf => {
            const selected = form.purchaseTimeframe === tf.val;
            return (
              <button
                key={tf.val}
                type="button"
                onClick={() => update("purchaseTimeframe", tf.val)}
                data-testid={`purchase-timeframe-${tf.val.toLowerCase()}`}
                className={`rounded-full border px-4 py-2.5 text-xs font-medium transition-all ${
                  selected
                    ? "bg-al-primary text-white border-al-primary"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      </FieldGroup>

      <ContinueButton onClick={onNext} testId="wizard-step1-continue" label="Continue" />
    </section>
  );
}

// ─── Step 2 ─────────────────────────────────────────────────────────────────────

function Step2({
  form, errors, update, onNext, onBack,
}: {
  form: FormState;
  errors: Partial<Record<keyof FormState, string>>;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const zipRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { zipRef.current?.focus(); }, []);

  const budgetN = parseCurrency(form.budget);
  const downN = parseCurrency(form.downPayment);
  const monthlyEst = budgetN > downN ? Math.round((budgetN - downN) / 60) : 0;

  return (
    <section data-testid="wizard-step-2" className="animate-fadein">
      <BackLink onClick={onBack} />
      <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">What&apos;s your budget?</h1>
      <p className="text-sm text-slate-600 mt-1.5 mb-7">
        We use this to match you with options that fit your financial goals.
      </p>

      <FieldGroup label="ZIP Code" testId="field-zip" error={errors.zip}>
        <input
          ref={zipRef}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={form.zip}
          onChange={(e) => update("zip", e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="e.g. 30309"
          data-testid="zip-input"
          className={`w-full rounded-lg border bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary ${
            errors.zip ? "border-red-400" : "border-slate-200"
          }`}
        />
      </FieldGroup>

      <FieldGroup label="Budget Target" testId="field-budget" error={errors.budget}>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={form.budget}
            onChange={(e) => update("budget", formatCurrency(e.target.value))}
            placeholder="35,000"
            data-testid="budget-input"
            className={`w-full rounded-lg border bg-white pl-9 pr-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary ${
              errors.budget ? "border-red-400" : "border-slate-200"
            }`}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1.5">Your all-in target price including taxes and fees.</p>
      </FieldGroup>

      <div className="my-6 flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200" />
        <p className="text-xs text-slate-400 uppercase tracking-wider">Optional — helps us find better matches</p>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldGroup label="Down Payment" testId="field-down-payment" optional>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={form.downPayment}
              onChange={(e) => update("downPayment", formatCurrency(e.target.value))}
              placeholder="5,000"
              data-testid="down-payment-input"
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
            />
          </div>
        </FieldGroup>
        <FieldGroup label="Monthly Payment Target" testId="field-monthly-target" optional>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={form.monthlyTarget}
              onChange={(e) => update("monthlyTarget", formatCurrency(e.target.value))}
              placeholder="500/mo"
              data-testid="monthly-target-input"
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
            />
          </div>
        </FieldGroup>
      </div>

      {/* Live summary */}
      <div
        data-testid="budget-summary"
        className="mt-6 rounded-xl border border-[#E5E7EB] bg-gradient-to-br from-[#F8F9FB] to-white p-5"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-al-primary mb-3">Your Budget Summary</p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Target price:</dt>
            <dd className="font-bold text-[#111827] font-mono" data-testid="summary-budget">
              {budgetN ? `$${budgetN.toLocaleString()}` : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">Down payment:</dt>
            <dd className="font-bold text-[#111827] font-mono" data-testid="summary-down">
              {downN ? `$${downN.toLocaleString()}` : "—"}
            </dd>
          </div>
          <div className="flex justify-between border-t border-[#E5E7EB] pt-2 mt-2">
            <dt className="text-slate-600">Est. monthly:</dt>
            <dd className="font-bold text-al-primary font-mono" data-testid="summary-monthly">
              {monthlyEst > 0 ? `~$${monthlyEst.toLocaleString()}/mo estimate` : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <ContinueButton onClick={onNext} testId="wizard-step2-continue" label="Continue" />
    </section>
  );
}

// ─── Step 3 ─────────────────────────────────────────────────────────────────────

function Step3({
  form, update, onBack, onNext,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  function toggleFeature(f: string) {
    const next = form.features.includes(f)
      ? form.features.filter(x => x !== f)
      : [...form.features, f];
    update("features", next);
  }

  const mileageIdx = MILEAGE_STOPS.indexOf(form.maxMileage);

  return (
    <section data-testid="wizard-step-3" className="animate-fadein">
      <BackLink onClick={onBack} />
      <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">Any specific preferences?</h1>
      <p className="text-sm text-slate-600 mt-1.5 mb-7">
        These are optional but help us find closer matches.
      </p>

      <FieldGroup label="Trim Preference" testId="field-trim" optional>
        <input
          type="text"
          value={form.trim}
          onChange={(e) => update("trim", e.target.value)}
          placeholder="e.g. EX, Sport, Limited"
          data-testid="trim-input"
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary"
        />
      </FieldGroup>

      <FieldGroup label="Maximum Mileage" testId="field-mileage" optional>
        <div className="px-1">
          <p className="text-xl font-bold text-al-primary font-mono mb-3" data-testid="mileage-value">
            {form.maxMileage === "Any" ? "Any mileage" : `Up to ${form.maxMileage}`}
          </p>
          <input
            type="range"
            min={0}
            max={MILEAGE_STOPS.length - 1}
            step={1}
            value={mileageIdx === -1 ? MILEAGE_STOPS.length - 1 : mileageIdx}
            onChange={(e) => update("maxMileage", MILEAGE_STOPS[Number(e.target.value)])}
            data-testid="mileage-slider"
            className="w-full accent-al-primary"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1.5">
            {MILEAGE_STOPS.map(s => <span key={s}>{s}</span>)}
          </div>
        </div>
      </FieldGroup>

      <FieldGroup label="Must-Have Features" testId="field-features" optional>
        <div className="flex flex-wrap gap-2">
          {FEATURES.map(f => {
            const selected = form.features.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFeature(f)}
                data-testid={`feature-${f.toLowerCase().replace(/\s+/g, "-")}`}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                  selected
                    ? "border-al-primary bg-al-primary-subtle text-al-primary"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
        {form.features.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="selected-features">
            {form.features.map(f => (
              <span key={f} className="inline-flex items-center gap-1 rounded-full bg-al-primary text-white text-xs px-2.5 py-1">
                {f}
                <button
                  type="button"
                  onClick={() => toggleFeature(f)}
                  data-testid={`dismiss-feature-${f.toLowerCase().replace(/\s+/g, "-")}`}
                  className="hover:opacity-80"
                  aria-label={`Remove ${f}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </FieldGroup>

      <ContinueButton onClick={onNext} testId="wizard-step3-continue" label="Continue to Financing" />
    </section>
  );
}

// ─── Step 4: Financing & Prequalification ─────────────────────────────────────

const PAYMENT_METHODS: { id: PaymentMethod; label: string; desc: string }[] = [
  { id: "FINANCE_AUTOLENIS", label: "Finance through AutoLenis", desc: "We'll help you get pre-approved" },
  { id: "FINANCE_OUTSIDE",   label: "Use outside lender",        desc: "I have my own financing" },
  { id: "CASH",              label: "Cash",                      desc: "No financing needed" },
  { id: "LEASE",             label: "Lease",                     desc: "I'd like to lease" },
  { id: "UNDECIDED",         label: "Undecided",                 desc: "Not sure yet" },
];
const CREDIT_RANGES: { id: CreditRange; label: string }[] = [
  { id: "EXCELLENT", label: "Excellent (720+)" },
  { id: "GOOD",      label: "Good (660–719)" },
  { id: "FAIR",      label: "Fair (600–659)" },
  { id: "BUILDING",  label: "Building (below 600)" },
  { id: "PREFER_NOT_TO_SAY", label: "Prefer not to say" },
];
const PURCHASE_TIMEFRAMES: { id: PurchaseTimeframe; label: string }[] = [
  { id: "ASAP",                label: "As soon as possible" },
  { id: "WITHIN_7_DAYS",       label: "Within 7 days" },
  { id: "WITHIN_30_DAYS",      label: "Within 30 days" },
  { id: "WITHIN_60_DAYS_PLUS", label: "60+ days" },
];

function Step4({
  financing, onUpdate, onBack, onSubmit, onSkip, loading, error, rateLimitSeconds,
}: {
  financing: FinancingState;
  onUpdate: (fin: FinancingState) => void;
  onBack: () => void;
  onSubmit: () => void;
  onSkip: () => void;
  loading: boolean;
  error: string | null;
  rateLimitSeconds: number;
}) {
  const [letterError, setLetterError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function set<K extends keyof FinancingState>(key: K, val: FinancingState[K]) {
    onUpdate({ ...financing, [key]: val });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setLetterError("File must be under 10 MB"); return; }
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) { setLetterError("PDF or image only"); return; }
    setLetterError(null);
    set("letterUploading", true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/buyer/requests/financing/upload-letter", { method: "POST", body: fd });
      const data = await res.json() as { success?: boolean; data?: { url: string }; error?: { message: string } };
      if (!res.ok || !data.success) { setLetterError(data.error?.message ?? "Upload failed"); return; }
      set("preApprovalLetterUrl", data.data?.url ?? "");
    } catch { setLetterError("Upload failed. Please try again."); }
    finally { set("letterUploading", false); }
  }

  const showPreApprovalQuestion = financing.paymentMethod === "FINANCE_AUTOLENIS" || financing.paymentMethod === "FINANCE_OUTSIDE";

  return (
    <section data-testid="wizard-step-4" className="animate-fadein">
      <BackLink onClick={onBack} />
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">How will you pay?</h1>
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          data-testid="skip-financing-btn"
          className="text-sm text-slate-400 hover:text-al-primary transition-colors mt-1 shrink-0"
        >
          Skip this step
        </button>
      </div>
      <p className="text-sm text-slate-600 mt-1 mb-6">
        Optional — helps us match you with better offers. <span className="text-slate-400">Skip anytime to submit.</span>
      </p>

      {/* Payment method */}
      <FieldGroup label="How do you plan to pay?" testId="field-payment-method">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PAYMENT_METHODS.map(pm => {
            const sel = financing.paymentMethod === pm.id;
            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => {
                  set("paymentMethod", pm.id);
                  // Reset dependent fields when payment method changes
                  // For CASH and LEASE, auto-set preApprovalStatus to match — the service layer uses preApprovalStatus for scoring/badge logic
                  const derivedStatus: PreApprovalStatus | "" =
                    pm.id === "CASH" ? "CASH" : pm.id === "LEASE" ? "LEASE" : "";
                  onUpdate({ ...financing, paymentMethod: pm.id, preApprovalStatus: derivedStatus });
                }}
                data-testid={`payment-method-${pm.id.toLowerCase()}`}
                className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${
                  sel ? "border-al-primary bg-al-primary-subtle" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className={`font-semibold text-sm ${sel ? "text-al-primary" : "text-slate-800"}`}>{pm.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{pm.desc}</p>
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* Pre-approval question — only for Finance options */}
      {showPreApprovalQuestion && (
        <FieldGroup label="Have you already been pre-approved?" testId="field-pre-approval-question">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Yes, I have a pre-approval", val: "APPROVED" as PreApprovalStatus },
              { label: "No, I need help", val: "WANTS_HELP" as PreApprovalStatus },
            ].map(opt => {
              const sel = financing.preApprovalStatus === opt.val;
              return (
                <button key={opt.val} type="button"
                  onClick={() => set("preApprovalStatus", opt.val)}
                  data-testid={`pre-approval-${opt.val.toLowerCase()}`}
                  className={`rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                    sel ? "border-al-primary bg-al-primary-subtle text-al-primary" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                  }`}
                >{opt.label}</button>
              );
            })}
            <button type="button"
              onClick={() => set("preApprovalStatus", "SELF_ARRANGE")}
              data-testid="pre-approval-self_arrange"
              className={`col-span-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                financing.preApprovalStatus === "SELF_ARRANGE"
                  ? "border-al-primary bg-al-primary-subtle text-al-primary"
                  : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
              }`}
            >Exploring options / I&apos;ll arrange my own</button>
          </div>
        </FieldGroup>
      )}

      {/* APPROVED branch */}
      {financing.preApprovalStatus === "APPROVED" && (
        <div className="space-y-0" data-testid="approved-branch">
          <FieldGroup label="Lender name" testId="field-lender-name" optional>
            <input type="text" value={financing.lenderName} onChange={e => set("lenderName", e.target.value)}
              placeholder="e.g. Capital One Auto, Chase, local CU"
              data-testid="lender-name-input"
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Approved amount" testId="field-approved-amount" optional>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                <input type="text" inputMode="numeric" value={financing.approvedAmount}
                  onChange={e => set("approvedAmount", formatCurrency(e.target.value))}
                  placeholder="30,000" data-testid="approved-amount-input"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
              </div>
            </FieldGroup>
            <FieldGroup label="APR (%)" testId="field-apr" optional>
              <input type="text" inputMode="decimal" value={financing.quotedApr}
                onChange={e => set("quotedApr", e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="6.99" data-testid="apr-input"
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
            </FieldGroup>
          </div>
          <FieldGroup label="Approval expiry date" testId="field-expiry" optional>
            <input type="date" value={financing.approvalExpiresAt}
              onChange={e => set("approvalExpiresAt", e.target.value)}
              data-testid="expiry-date-input"
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Down payment planned" testId="field-down-approved" optional>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                <input type="text" inputMode="numeric" value={financing.downPayment}
                  onChange={e => set("downPayment", formatCurrency(e.target.value))}
                  placeholder="5,000" data-testid="down-payment-approved-input"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
              </div>
            </FieldGroup>
            <FieldGroup label="Monthly target" testId="field-monthly-approved" optional>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                <input type="text" inputMode="numeric" value={financing.monthlyPaymentTarget}
                  onChange={e => set("monthlyPaymentTarget", formatCurrency(e.target.value))}
                  placeholder="500" data-testid="monthly-target-approved-input"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
              </div>
            </FieldGroup>
          </div>
          <FieldGroup label="Upload pre-approval letter" testId="field-letter-upload" optional>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                disabled={financing.letterUploading}
                data-testid="upload-letter-btn"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-al-primary hover:text-al-primary transition-colors disabled:opacity-60">
                {financing.letterUploading
                  ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                  : <><Upload size={14} /> {financing.preApprovalLetterUrl ? "Replace file" : "Choose file"}</>}
              </button>
              {financing.preApprovalLetterUrl && (
                <span className="text-xs text-green-700 font-medium" data-testid="letter-upload-success">✓ File uploaded</span>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handleFileUpload} className="hidden" data-testid="letter-file-input" />
            </div>
            <p className="text-xs text-slate-400 mt-1">PDF or image, max 10 MB. Optional.</p>
            {letterError && <p className="text-xs text-red-600 mt-1">{letterError}</p>}
          </FieldGroup>
        </div>
      )}

      {/* WANTS_HELP branch */}
      {financing.preApprovalStatus === "WANTS_HELP" && (
        <div data-testid="wants-help-branch">
          <FieldGroup label="Estimated credit range" testId="field-credit-range" optional>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CREDIT_RANGES.map(cr => {
                const sel = financing.estimatedCreditRange === cr.id;
                return (
                  <button key={cr.id} type="button" onClick={() => set("estimatedCreditRange", cr.id)}
                    data-testid={`credit-range-${cr.id.toLowerCase()}`}
                    className={`rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all text-left ${
                      sel ? "border-al-primary bg-al-primary-subtle text-al-primary" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >{cr.label}</button>
                );
              })}
            </div>
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Est. annual income" testId="field-income" optional>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                <input type="text" inputMode="numeric" value={financing.estimatedAnnualIncome}
                  onChange={e => set("estimatedAnnualIncome", formatCurrency(e.target.value))}
                  placeholder="65,000" data-testid="annual-income-input"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
              </div>
            </FieldGroup>
            <FieldGroup label="Down payment available" testId="field-down-help" optional>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                <input type="text" inputMode="numeric" value={financing.downPayment}
                  onChange={e => set("downPayment", formatCurrency(e.target.value))}
                  placeholder="3,000" data-testid="down-payment-help-input"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
              </div>
            </FieldGroup>
          </div>
          <FieldGroup label="Monthly payment target" testId="field-monthly-help" optional>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
              <input type="text" inputMode="numeric" value={financing.monthlyPaymentTarget}
                onChange={e => set("monthlyPaymentTarget", formatCurrency(e.target.value))}
                placeholder="450" data-testid="monthly-target-help-input"
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
            </div>
          </FieldGroup>
        </div>
      )}

      {/* CASH branch */}
      {financing.preApprovalStatus === "CASH" && (
        <div data-testid="cash-branch">
          <FieldGroup label="Do you have proof of funds available?" testId="field-proof-funds">
            <div className="grid grid-cols-2 gap-3">
              {[{ label: "Yes", val: true }, { label: "No", val: false }].map(opt => {
                const sel = financing.proofOfFundsAvailable === opt.val;
                return (
                  <button key={String(opt.val)} type="button"
                    onClick={() => set("proofOfFundsAvailable", opt.val)}
                    data-testid={`proof-funds-${opt.label.toLowerCase()}`}
                    className={`rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                      sel ? "border-al-primary bg-al-primary-subtle text-al-primary" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                    }`}
                  >{opt.label}</button>
                );
              })}
            </div>
          </FieldGroup>
          <FieldGroup label="Maximum budget" testId="field-cash-budget" optional>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
              <input type="text" inputMode="numeric" value={financing.maxBudget}
                onChange={e => set("maxBudget", formatCurrency(e.target.value))}
                placeholder="45,000" data-testid="cash-budget-input"
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
            </div>
          </FieldGroup>
        </div>
      )}

      {/* LEASE branch */}
      {financing.preApprovalStatus === "LEASE" && (
        <div data-testid="lease-branch">
          <FieldGroup label="Lease term preference" testId="field-lease-term">
            <div className="grid grid-cols-3 gap-3">
              {([24, 36, 48] as const).map(months => {
                const sel = financing.leaseTermMonths === months;
                return (
                  <button key={months} type="button" onClick={() => set("leaseTermMonths", months)}
                    data-testid={`lease-term-${months}`}
                    className={`rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                      sel ? "border-al-primary bg-al-primary-subtle text-al-primary" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                    }`}
                  >{months} months</button>
                );
              })}
            </div>
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Miles per year" testId="field-lease-miles" optional>
              <input type="text" inputMode="numeric" value={financing.leaseMilesPerYear}
                onChange={e => set("leaseMilesPerYear", e.target.value.replace(/\D/g, ""))}
                placeholder="12,000" data-testid="lease-miles-input"
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
            </FieldGroup>
            <FieldGroup label="Down payment planned" testId="field-down-lease" optional>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                <input type="text" inputMode="numeric" value={financing.downPayment}
                  onChange={e => set("downPayment", formatCurrency(e.target.value))}
                  placeholder="2,000" data-testid="down-payment-lease-input"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary" />
              </div>
            </FieldGroup>
          </div>
        </div>
      )}

      {/* Universal fields — shown to all once a payment method is selected */}
      {financing.paymentMethod && (
        <div data-testid="universal-fields">
          <FieldGroup label="Do you have a trade-in?" testId="field-trade-in">
            <div className="grid grid-cols-2 gap-3">
              {[{ label: "Yes", val: true }, { label: "No", val: false }].map(opt => {
                const sel = financing.tradeIn === opt.val;
                return (
                  <button key={String(opt.val)} type="button" onClick={() => set("tradeIn", opt.val)}
                    data-testid={`trade-in-${opt.label.toLowerCase()}`}
                    className={`rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                      sel ? "border-al-primary bg-al-primary-subtle text-al-primary" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                    }`}
                  >{opt.label}</button>
                );
              })}
            </div>
          </FieldGroup>

          <FieldGroup label="How soon are you looking to buy?" testId="field-purchase-timeframe">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {PURCHASE_TIMEFRAMES.map(tf => {
                const sel = financing.purchaseTimeframe === tf.id;
                return (
                  <button key={tf.id} type="button" onClick={() => set("purchaseTimeframe", tf.id)}
                    data-testid={`timeframe-${tf.id.toLowerCase()}`}
                    className={`rounded-full border px-4 py-2.5 text-xs font-medium transition-all ${
                      sel ? "bg-al-primary text-white border-al-primary" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    }`}
                  >{tf.label}</button>
                );
              })}
            </div>
          </FieldGroup>
        </div>
      )}

      {/* Trust signals */}
      <div className="my-7 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs" data-testid="trust-signals">
        <TrustItem icon={<ShieldCheck size={14} />} text="Soft credit check only" />
        <TrustItem icon={<RefreshCw size={14} />} text="$99 — refund on request if no match" />
        <TrustItem icon={<Clock size={14} />} text="Dealers respond within 48 hours" />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="submit-error">
          <p>{error}</p>
          {rateLimitSeconds > 0 && (
            <p className="mt-1 text-xs font-mono" data-testid="rate-limit-countdown">
              Try again in {Math.floor(rateLimitSeconds / 60)}m {rateLimitSeconds % 60}s
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || rateLimitSeconds > 0}
        data-testid="submit-request-btn"
        className="w-full h-12 rounded-lg bg-al-primary text-white font-semibold text-sm hover:bg-al-primary-hover active:scale-[0.99] transition-all shadow-md shadow-al-primary/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (<><Loader2 size={16} className="animate-spin" /> Submitting your request…</>)
                 : "Submit My Request"}
      </button>
      <p className="text-center text-xs text-slate-400 mt-3">
        Or{" "}
        <button type="button" onClick={onSkip} disabled={loading}
          data-testid="skip-financing-bottom-btn"
          className="text-al-primary hover:underline">
          skip financing and submit now
        </button>
      </p>
    </section>
  );
}

function SuccessState({ requestId }: { requestId: string }) {
  const ref = `#${requestId.slice(0, 8).toUpperCase()}`;
  return (
    <div
      className="min-h-full bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD] flex items-center justify-center px-5 py-10"
      data-testid="success-state"
    >
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto h-20 w-20 mb-6 relative">
          <span className="absolute inset-0 rounded-full bg-[#50D14E]/15 animate-ping" />
          <span className="relative h-20 w-20 rounded-full bg-[#50D14E] text-white flex items-center justify-center shadow-lg shadow-[#50D14E]/30">
            <Check size={40} strokeWidth={3} />
          </span>
        </div>

        <h1 className="text-3xl font-bold text-[#111827] tracking-tight mb-2" data-testid="success-headline">
          Your request has been received!
        </h1>
        <p className="text-slate-600 mb-1.5">
          We&apos;re reviewing your information and will begin searching for the best options.
        </p>
        <p className="text-sm font-mono text-al-primary mb-7" data-testid="success-ref">
          Request {ref}
        </p>

        {/* Status tracker */}
        <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 mb-7 text-left" data-testid="success-tracker">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Where you are</p>
          <ol className="grid grid-cols-5 gap-1">
            {["Request Received", "Searching", "Options Ready", "Selection", "Deal"].map((label, i) => (
              <li key={label} className="flex flex-col items-center text-center" data-testid={`tracker-stage-${i + 1}`}>
                <span className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  i === 0 ? "bg-al-primary text-white" : "bg-slate-100 text-slate-400"
                }`}>
                  {i === 0 ? <Check size={12} /> : i + 1}
                </span>
                <span className={`text-[10px] mt-1.5 leading-tight ${
                  i === 0 ? "text-al-primary font-semibold" : "text-slate-400"
                }`}>{label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={`/buyer/requests/${requestId}`}
            data-testid="view-request-btn"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-al-primary text-white font-semibold text-sm px-6 h-12 hover:bg-al-primary-hover transition-colors shadow-md shadow-al-primary/20"
          >
            View Your Request <ArrowRight size={14} />
          </Link>
          <Link
            href="/buyer/dashboard"
            data-testid="back-to-dashboard-btn"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 font-medium text-sm px-6 h-12 hover:bg-slate-50 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>

        <p className="text-xs text-slate-400 mt-5" data-testid="auto-redirect-notice">
          You&apos;ll be redirected automatically in a few seconds…
        </p>
      </div>
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────────

function FieldGroup({
  label, optional, error, testId, children,
}: {
  label: string; optional?: boolean; error?: string; testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5" data-testid={testId}>
      <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 mb-2">
        {label}
        {optional && <span className="text-[10px] text-slate-400 font-normal uppercase tracking-wider">Optional</span>}
      </label>
      {children}
      {error && <p className="mt-1.5 text-xs text-red-600" data-testid={`${testId}-error`}>{error}</p>}
    </div>
  );
}

function ContinueButton({ onClick, testId, label }: { onClick: () => void; testId: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="mt-7 w-full h-12 rounded-lg bg-al-primary text-white font-semibold text-sm hover:bg-al-primary-hover active:scale-[0.99] transition-all shadow-md shadow-al-primary/20 flex items-center justify-center gap-2"
    >
      {label} <ArrowRight size={16} />
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="wizard-back-btn"
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-al-primary mb-4 transition-colors"
    >
      <ChevronLeft size={14} /> Back
    </button>
  );
}

function TrustItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2.5">
      <span className="text-al-primary">{icon}</span>
      <span className="text-slate-700 font-medium">{text}</span>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, Loader2, Upload, Lock, ShieldCheck,
  RefreshCw, ChevronLeft, FileText, CreditCard,
} from "lucide-react";
import { POPULAR_MAKES, fetchModelsForMake } from "@/lib/utils/vehicle-makes";

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"] as const;
const NEW_USED = ["New", "Used", "Either"] as const;
const BUDGETS = [
  "Under $15,000", "$15,000–$25,000", "$25,000–$35,000",
  "$35,000–$50,000", "$50,000–$75,000", "$75,000+",
];
const FINANCING_OPTIONS = [
  { val: "need_financing", label: "I Need Financing", desc: "Help me get pre-qualified" },
  { val: "have_financing", label: "I Have Financing", desc: "I have a pre-approval" },
  { val: "no_financing",   label: "Paying Cash",      desc: "No financing needed" },
] as const;
const EMPLOYMENT = ["Employed Full-Time", "Employed Part-Time", "Self-Employed", "Retired", "Student", "Other"];
const INCOMES   = ["Under $30,000", "$30,000–$50,000", "$50,000–$75,000", "$75,000–$100,000", "$100,000–$150,000", "$150,000+"];
const CREDIT    = ["Excellent (750+)", "Good (700–749)", "Fair (650–699)", "Below Average (600–649)", "Poor (below 600)", "Not Sure"];
const DOWNS     = ["$0–$1,000", "$1,000–$3,000", "$3,000–$5,000", "$5,000–$10,000", "$10,000+"];
const PAYMENTS  = ["Under $300", "$300–$500", "$500–$700", "$700–$1,000", "Over $1,000"];
const TRADE_CONDITIONS = ["Excellent", "Good", "Fair", "Poor"];
const TITLE_STATUSES = [
  { val: "clean", label: "Clean" }, { val: "salvage", label: "Salvage" },
  { val: "rebuilt", label: "Rebuilt" }, { val: "not_sure", label: "Not Sure" },
];
const REQUEST_YEARS = Array.from({ length: 17 }, (_, i) => 2026 - i);
const TRADE_YEARS = Array.from({ length: 31 }, (_, i) => 2025 - i);
const MONTHLY_GOALS = ["Under $300", "$300–$400", "$400–$500", "$500–$600", "$600–$700", "$700–$800", "$800–$1,000", "Over $1,000"];
const DOWN_AVAILABLE = ["$0", "$1,000–$2,000", "$2,000–$5,000", "$5,000–$10,000", "$10,000+"];
const MONTHLY_INCOMES = ["Under $2,500", "$2,500–$4,000", "$4,000–$6,000", "$6,000–$8,000", "$8,000–$12,000", "$12,000+"];
const HOUSING = ["Under $500", "$500–$1,000", "$1,000–$1,500", "$1,500–$2,000", "$2,000–$2,500", "$2,500+"];
const ACCIDENT_HISTORY = ["Clean — No accidents", "1 Accident on record", "2+ Accidents", "Unknown"];
const CONTACT_METHODS = ["Phone Call", "Text Message", "Email"] as const;
const TIMELINES = ["ASAP", "Within 30 Days", "Within 60 Days", "Just Researching"] as const;

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
];

const TOTAL_STEPS = 5;
const STEP_LABELS = ["Contact", "Vehicle", "Financing", "Trade-In", "Review"];

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const SEL_CLS = [
  "w-full h-12 rounded-xl border-2 border-[#E2E8F0] bg-white px-4",
  "text-sm font-medium text-[#111827] cursor-pointer appearance-none",
  "focus:border-[#0B5FD1] focus:ring-2 focus:ring-[#0B5FD1]/15 focus:outline-none",
  "hover:border-[#0B5FD1]/30 transition-all",
].join(" ");

const SEL_STYLE: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 16px center",
};

const INP_CLS = [
  "h-12 rounded-xl border-[#E2E8F0] bg-white text-[#111827] font-medium",
  "focus:border-[#0B5FD1] focus:ring-2 focus:ring-[#0B5FD1]/15 transition-all",
].join(" ");

const AREA_CLS = [
  "rounded-xl border-[#E2E8F0] bg-white text-[#111827] font-medium resize-none",
  "focus:border-[#0B5FD1] focus:ring-2 focus:ring-[#0B5FD1]/15 transition-all",
].join(" ");

const BTN_SELECTED = "border-[#0B5FD1] bg-[#0B5FD1] text-white shadow-md shadow-[#0B5FD1]/20";
const BTN_IDLE = "border-[#E2E8F0] bg-white text-[#374151] hover:border-[#0B5FD1]/40 hover:bg-[#F8FAFF]";

function PremiumStepBar({
  currentStep, total, labels,
}: {
  currentStep: number; total: number; labels: string[];
}) {
  return (
    <div className="border-b border-[#E2E8F0] px-6 md:px-8 py-4">
      <span className="sr-only" data-testid="rv-step-indicator">Step {currentStep} of {total}</span>
      <div className="flex items-center">
        {labels.map((label, i) => {
          const step = i + 1;
          const isComplete = step < currentStep;
          const isActive = step === currentStep;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                  isComplete
                    ? "bg-[#0B5FD1] text-white"
                    : isActive
                    ? "bg-[#0B5FD1] text-white ring-4 ring-[#0B5FD1]/15"
                    : "bg-[#F1F5F9] text-[#94A3B8]"
                }`}>
                  {isComplete ? <CheckCircle2 size={14} /> : step}
                </div>
                <span className={`text-[10px] font-semibold hidden sm:block ${
                  isActive || isComplete ? "text-[#0B5FD1]" : "text-[#CBD5E1]"
                }`}>
                  {label}
                </span>
              </div>
              {i < labels.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 transition-all duration-500 ${
                  step < currentStep ? "bg-[#0B5FD1]" : "bg-[#E2E8F0]"
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepHeader({ title, subtitle, step }: { title: string; subtitle?: string; step?: number }) {
  return (
    <div className="mb-7">
      {step !== undefined && (
        <p className="text-xs font-bold text-[#0B5FD1] uppercase tracking-widest mb-1.5">
          Step {step}
        </p>
      )}
      <h2 className="text-xl font-bold text-[#0F172A]">{title}</h2>
      {subtitle && <p className="text-sm text-[#64748B] mt-1">{subtitle}</p>}
    </div>
  );
}

function ReviewCard({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-4">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1.5">{label}</p>
          {children}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-semibold text-[#0B5FD1] hover:text-[#0944A8] shrink-0 border border-[#0B5FD1]/20 rounded-lg px-3 py-1 hover:bg-[#EFF6FF] transition-all"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function SuccessState({ name }: { name: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 md:p-14 text-center shadow-sm" data-testid="rv-success">
      <div className="w-20 h-20 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-6">
        <CheckCircle2 size={36} className="text-[#059669]" />
      </div>
      <h2 className="text-2xl font-bold text-[#0F172A] mb-2">Request Received</h2>
      <p className="text-[#64748B] text-base mb-2">
        Thank you, <span className="font-semibold text-[#0F172A]">{name}</span>.
      </p>
      <p className="text-[#64748B] text-sm mb-8 max-w-sm mx-auto">
        Your concierge team is now sourcing dealer offers. You&apos;ll hear from us within 24 hours.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href="/"
          data-testid="rv-success-home-link"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B5FD1] text-white px-6 py-3 text-sm font-bold hover:bg-[#0944A8] transition-colors shadow-md shadow-[#0B5FD1]/20"
        >
          Back to AutoLenis
        </a>
      </div>
    </div>
  );
}

function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  testIdPrefix,
  cols = 3,
}: {
  options: readonly T[];
  value: T | "";
  onChange: (v: T) => void;
  testIdPrefix: string;
  cols?: 2 | 3 | 4;
}) {
  const grid =
    cols === 2 ? "grid-cols-2" :
    cols === 3 ? "sm:grid-cols-3 grid-cols-1" :
    "sm:grid-cols-4 grid-cols-2";
  return (
    <div className={`grid ${grid} gap-2.5`}>
      {options.map((opt) => {
        const isSelected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            data-testid={`${testIdPrefix}-${opt.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
            className={`relative rounded-xl border-2 py-3 px-4 text-sm font-semibold transition-all duration-150 text-left ${
              isSelected ? BTN_SELECTED : BTN_IDLE
            }`}
          >
            {isSelected && (
              <CheckCircle2 size={14} className="absolute top-2.5 right-2.5 text-white/80" />
            )}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function YesNoToggle({
  value,
  onChange,
  testIdPrefix,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="inline-flex rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-1 gap-1">
      {(["Yes", "No"] as const).map((opt) => {
        const boolVal = opt === "Yes";
        const isSelected = value === boolVal;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(boolVal)}
            data-testid={`${testIdPrefix}-${opt.toLowerCase()}`}
            className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
              isSelected ? "bg-[#0B5FD1] text-white shadow-sm" : "text-[#6B7280] hover:text-[#374151]"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default function RequestVehicleFormClient() {
  const [currentStep, setCurrentStep] = useState(1);

  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §1 Contact
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [contactMethod, setContactMethod] = useState<typeof CONTACT_METHODS[number] | "">("");
  const [timeline, setTimeline] = useState<typeof TIMELINES[number] | "">("");

  // §2 Vehicle
  const [vehicleType, setVehicleType] = useState("");
  const [preferredMake, setPreferredMake] = useState("");
  const [preferredModel, setPreferredModel] = useState("");
  const [customMakeModel, setCustomMakeModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [minYear, setMinYear] = useState("");
  const [maxYear, setMaxYear] = useState("");
  const [newOrUsed, setNewOrUsed] = useState("");
  const [specificFeatures, setSpecificFeatures] = useState("");
  const [interiorColor, setInteriorColor] = useState("");
  const [mustHaveFeatures, setMustHaveFeatures] = useState("");
  const [openToAlternatives, setOpenToAlternatives] = useState<boolean | null>(null);

  // §3 Budget + financing
  const [budget, setBudget] = useState("");
  const [desiredMonthlyPayment, setDesiredMonthlyPayment] = useState("");
  const [downPaymentAvailable, setDownPaymentAvailable] = useState("");
  const [financingOption, setFinancingOption] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [annualIncome, setAnnualIncome] = useState("");
  const [creditScore, setCreditScore] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [monthlyPayment, setMonthlyPayment] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [housingPayment, setHousingPayment] = useState("");
  const [coBuyer, setCoBuyer] = useState<boolean | null>(null);
  const [lenderName, setLenderName] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [apr, setApr] = useState("");
  const [preApprovalExpiry, setPreApprovalExpiry] = useState("");
  const [preApprovalFile, setPreApprovalFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // §4 Trade-in
  const [hasTradeIn, setHasTradeIn] = useState<boolean | null>(null);
  const [tradeYear, setTradeYear] = useState("");
  const [tradeMake, setTradeMake] = useState("");
  const [tradeModel, setTradeModel] = useState("");
  const [tradeModels, setTradeModels] = useState<string[]>([]);
  const [tradeTrim, setTradeTrim] = useState("");
  const [tradeMileage, setTradeMileage] = useState("");
  const [tradeColor, setTradeColor] = useState("");
  const [tradeCondition, setTradeCondition] = useState("");
  const [tradeVin, setTradeVin] = useState("");
  const [tradePaidOff, setTradePaidOff] = useState<boolean | null>(null);
  const [tradePayoffAmount, setTradePayoffAmount] = useState("");
  const [tradeIssues, setTradeIssues] = useState("");
  const [tradeTitleStatus, setTradeTitleStatus] = useState("");
  const [tradeAccidentHistory, setTradeAccidentHistory] = useState("");

  // §5 Notes + consent
  const [notes, setNotes] = useState("");
  const [agreedToContact, setAgreedToContact] = useState(false);
  // Explicit, optional TCPA SMS consent — persisted to consent_sms only when checked.
  const [smsConsent, setSmsConsent] = useState(false);

  useEffect(() => {
    if (!preferredMake || preferredMake === "Other") {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    fetchModelsForMake(preferredMake).then((m) => {
      if (!cancelled) {
        setModels(m);
        setLoadingModels(false);
      }
    });
    return () => { cancelled = true; };
  }, [preferredMake]);

  useEffect(() => {
    if (!tradeMake || tradeMake === "Other") {
      setTradeModels([]);
      return;
    }
    let cancelled = false;
    fetchModelsForMake(tradeMake).then((m) => {
      if (!cancelled) setTradeModels(m);
    });
    return () => { cancelled = true; };
  }, [tradeMake]);

  function handleFile(f: File | null) {
    setFileError(null);
    if (!f) { setPreApprovalFile(null); return; }
    if (!ACCEPTED_FILE_TYPES.includes(f.type)) {
      setFileError("File must be PDF, JPG, PNG, or WEBP.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError("File must be 10 MB or smaller.");
      return;
    }
    setPreApprovalFile(f);
  }

  const zipValid = /^\d{5}$/.test(zip);

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1:
        return Boolean(
          firstName.trim() && lastName.trim() &&
          /\S+@\S+\.\S+/.test(email) &&
          phone.trim().length >= 7 &&
          zipValid && city.trim() && state && contactMethod && timeline,
        );
      case 2:
        return Boolean(vehicleType && newOrUsed && openToAlternatives !== null);
      case 3:
        return Boolean(budget && financingOption);
      case 4:
        if (hasTradeIn === true) {
          return Boolean(tradeYear && tradeMake && tradeModel && tradeMileage && tradeCondition && tradePaidOff !== null && tradeAccidentHistory && tradeTitleStatus);
        }
        return true;
      case 5:
        return agreedToContact;
      default:
        return false;
    }
  }, [
    currentStep, firstName, lastName, email, phone, zipValid, city, state, contactMethod, timeline,
    vehicleType, newOrUsed, openToAlternatives, budget, financingOption,
    hasTradeIn, tradeYear, tradeMake, tradeModel, tradeMileage, tradeCondition, tradePaidOff, tradeAccidentHistory, tradeTitleStatus,
    agreedToContact,
  ]);

  const canSubmit = canProceed && currentStep === TOTAL_STEPS && !loading;

  function handleNext() {
    if (!canProceed) return;
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function jumpTo(step: number) {
    setCurrentStep(step);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildPayload() {
    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      zip,
      city: city.trim(),
      state,
      contactMethod,
      timeline,
      vehicleType,
      preferredMake: preferredMake || undefined,
      preferredModel: (preferredMake === "Other" ? undefined : preferredModel) || undefined,
      customMakeModel: preferredMake === "Other" ? customMakeModel || undefined : undefined,
      minYear: minYear ? Number(minYear) : undefined,
      maxYear: maxYear ? Number(maxYear) : undefined,
      newOrUsed,
      specificFeatures: specificFeatures || undefined,
      interiorColor: interiorColor || undefined,
      mustHaveFeatures: mustHaveFeatures || undefined,
      openToAlternatives: openToAlternatives === true,
      budget,
      desiredMonthly: desiredMonthlyPayment || undefined,
      downPaymentAvail: downPaymentAvailable || undefined,
      financingOption,
      ...(financingOption === "need_financing" && {
        employmentStatus: employmentStatus || undefined,
        employerName: employerName || undefined,
        annualIncome: annualIncome || undefined,
        creditScore: creditScore || undefined,
        downPayment: downPayment || undefined,
        monthlyPayment: monthlyPayment || undefined,
        monthlyIncome: monthlyIncome || undefined,
        housingPayment: housingPayment || undefined,
        coBuyer: coBuyer ?? undefined,
      }),
      ...(financingOption === "have_financing" && {
        lenderName: lenderName || undefined,
        approvedAmount: approvedAmount || undefined,
        apr: apr || undefined,
        preApprovalExpiry: preApprovalExpiry || undefined,
      }),
      hasTradeIn: hasTradeIn ?? false,
      ...(hasTradeIn && {
        tradeYear: tradeYear || undefined,
        tradeMake: tradeMake || undefined,
        tradeModel: tradeModel || undefined,
        tradeTrim: tradeTrim || undefined,
        tradeMileage: tradeMileage || undefined,
        tradeColor: tradeColor || undefined,
        tradeCondition: tradeCondition || undefined,
        tradeVin: tradeVin || undefined,
        tradePaidOff: tradePaidOff ?? undefined,
        tradeLoanBalance: tradePaidOff === false ? tradePayoffAmount || undefined : undefined,
        tradePayoffAmount: tradePaidOff === false ? tradePayoffAmount || undefined : undefined,
        tradeIssues: tradeIssues || undefined,
        tradeTitleStatus: tradeTitleStatus || undefined,
        tradeAccidentHistory: tradeAccidentHistory || undefined,
      }),
      notes: notes || undefined,
      agreedToContact: true as const,
      // Persist the buyer's actual, explicit SMS consent (never inferred). The
      // outbound-SMS gate reads consent_sms, so an unchecked box → no SMS.
      consent_sms: smsConsent,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      let res: Response;
      if (financingOption === "have_financing" && preApprovalFile) {
        const fd = new FormData();
        fd.append("data", JSON.stringify(buildPayload()));
        fd.append("preApprovalFile", preApprovalFile);
        res = await fetch("/api/public/request-vehicle", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/public/request-vehicle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
      }
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !data.success) {
        setError(data.error?.message ?? "Submission failed.");
        return;
      }
      setSubmittedName(firstName);
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F0F4F8]" data-testid="request-vehicle-page">
      {/* Top header bar */}
      <div className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#0B5FD1" />
              <path d="M8 22L16 10L24 22H8Z" fill="white" opacity="0.9" />
            </svg>
            <span className="font-bold text-[#0B5FD1] text-lg tracking-tight">AutoLenis</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <Lock size={12} />
            <span>Secure &amp; Encrypted</span>
          </div>
        </div>
      </div>

      {/* Form content */}
      <div className="max-w-2xl mx-auto px-4 py-8 md:py-12">
        {submitted ? (
          <SuccessState name={submittedName} />
        ) : (
          <>
            <p className="text-xs font-bold text-[#0B5FD1] uppercase tracking-widest mb-2 text-center">
              Car Buying Concierge
            </p>
            <h1 className="text-2xl md:text-3xl font-bold text-[#0F172A] text-center mb-1">
              Tell Us What You Want
            </h1>
            <p className="text-[#64748B] text-center text-sm mb-8">
              Verified dealers compete for your business. Takes about 3 minutes.
            </p>

            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              <PremiumStepBar currentStep={currentStep} total={TOTAL_STEPS} labels={STEP_LABELS} />

              <div className="px-6 md:px-8 py-8">
                <form onSubmit={handleSubmit} data-testid="request-vehicle-form">

                  {/* ── Step 1: Contact ── */}
                  {currentStep === 1 && (
                    <>
                      <StepHeader
                        title="Tell us about yourself"
                        subtitle="We'll use this to send updates on your request."
                        step={1}
                      />
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-first-name">
                              First Name <span className="text-[#EF4444]">*</span>
                            </label>
                            <Input
                              id="rv-first-name"
                              data-testid="rv-first-name"
                              placeholder="John"
                              className={INP_CLS}
                              value={firstName}
                              onChange={(e) => setFirstName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-last-name">
                              Last Name <span className="text-[#EF4444]">*</span>
                            </label>
                            <Input
                              id="rv-last-name"
                              data-testid="rv-last-name"
                              placeholder="Smith"
                              className={INP_CLS}
                              value={lastName}
                              onChange={(e) => setLastName(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-email">
                              Email <span className="text-[#EF4444]">*</span>
                            </label>
                            <Input
                              id="rv-email"
                              type="email"
                              data-testid="rv-email"
                              placeholder="john@email.com"
                              className={INP_CLS}
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-phone">
                              Phone <span className="text-[#EF4444]">*</span>
                            </label>
                            <Input
                              id="rv-phone"
                              type="tel"
                              data-testid="rv-phone"
                              placeholder="(555) 000-0000"
                              className={INP_CLS}
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-zip">
                            ZIP Code <span className="text-[#EF4444]">*</span>
                          </label>
                          <Input
                            id="rv-zip"
                            data-testid="rv-zip"
                            placeholder="75001"
                            maxLength={5}
                            className={`${INP_CLS} max-w-[140px]`}
                            value={zip}
                            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                          />
                          {zip.length > 0 && !zipValid && (
                            <p className="text-xs text-red-600 mt-1">Enter a 5-digit ZIP.</p>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-city">
                              City <span className="text-[#EF4444]">*</span>
                            </label>
                            <Input
                              id="rv-city"
                              data-testid="rv-city"
                              placeholder="Dallas"
                              className={INP_CLS}
                              value={city}
                              onChange={(e) => setCity(e.target.value.slice(0, 100))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-sm font-semibold text-[#374151]" htmlFor="rv-state">
                              State <span className="text-[#EF4444]">*</span>
                            </label>
                            <select
                              id="rv-state"
                              data-testid="rv-state"
                              className={SEL_CLS}
                              style={SEL_STYLE}
                              value={state}
                              onChange={(e) => setState(e.target.value)}
                            >
                              <option value="">Select state</option>
                              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#374151]">
                            Preferred Contact Method <span className="text-[#EF4444]">*</span>
                          </p>
                          <ButtonGroup
                            options={CONTACT_METHODS}
                            value={contactMethod}
                            onChange={setContactMethod}
                            testIdPrefix="rv-contact"
                            cols={3}
                          />
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#374151]">
                            Buying Timeline <span className="text-[#EF4444]">*</span>
                          </p>
                          <ButtonGroup
                            options={TIMELINES}
                            value={timeline}
                            onChange={setTimeline}
                            testIdPrefix="rv-timeline"
                            cols={4}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Step 2: Vehicle ── */}
                  {currentStep === 2 && (
                    <>
                      <StepHeader title="What vehicle are you looking for?" step={2} />
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#374151]">
                            Vehicle Type <span className="text-[#EF4444]">*</span>
                          </p>
                          <ButtonGroup
                            options={VEHICLE_TYPES}
                            value={vehicleType as typeof VEHICLE_TYPES[number] | ""}
                            onChange={(v) => setVehicleType(v)}
                            testIdPrefix="rv-type"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold text-[#374151]">
                              Make {loadingModels && <span className="text-[#94A3B8] text-xs ml-1 font-normal">Loading…</span>}
                            </p>
                            <select
                              data-testid="rv-make"
                              className={SEL_CLS}
                              style={SEL_STYLE}
                              value={preferredMake}
                              onChange={(e) => {
                                setPreferredMake(e.target.value);
                                setPreferredModel("");
                                setCustomMakeModel("");
                              }}
                            >
                              <option value="">Any Make</option>
                              {POPULAR_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold text-[#374151]">Model</p>
                            {preferredMake === "Other" ? (
                              <Input
                                data-testid="rv-custom-make-model"
                                placeholder="Enter make and model"
                                className={INP_CLS}
                                value={customMakeModel}
                                onChange={(e) => setCustomMakeModel(e.target.value)}
                              />
                            ) : (
                              <select
                                data-testid="rv-model"
                                className={SEL_CLS}
                                style={SEL_STYLE}
                                value={preferredModel}
                                onChange={(e) => setPreferredModel(e.target.value)}
                                disabled={!preferredMake || loadingModels}
                              >
                                <option value="">Any Model</option>
                                {models.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold text-[#374151]">Min Year</p>
                            <select
                              data-testid="rv-min-year"
                              className={SEL_CLS}
                              style={SEL_STYLE}
                              value={minYear}
                              onChange={(e) => setMinYear(e.target.value)}
                            >
                              <option value="">No Minimum</option>
                              {REQUEST_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold text-[#374151]">Max Year</p>
                            <select
                              data-testid="rv-max-year"
                              className={SEL_CLS}
                              style={SEL_STYLE}
                              value={maxYear}
                              onChange={(e) => setMaxYear(e.target.value)}
                            >
                              <option value="">No Maximum</option>
                              {REQUEST_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#374151]">
                            New or Used? <span className="text-[#EF4444]">*</span>
                          </p>
                          <ButtonGroup
                            options={NEW_USED}
                            value={newOrUsed as typeof NEW_USED[number] | ""}
                            onChange={(v) => setNewOrUsed(v)}
                            testIdPrefix="rv-new-used"
                            cols={3}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-sm font-semibold text-[#374151]">Specific Features</p>
                          <Input
                            data-testid="rv-features"
                            placeholder="e.g. Black exterior, sunroof, third row, AWD…"
                            className={INP_CLS}
                            value={specificFeatures}
                            onChange={(e) => setSpecificFeatures(e.target.value.slice(0, 500))}
                            maxLength={500}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-sm font-semibold text-[#374151]">Interior Color Preference</p>
                          <Input
                            data-testid="rv-interior-color"
                            placeholder="e.g. Black, Beige, Gray"
                            className={INP_CLS}
                            value={interiorColor}
                            onChange={(e) => setInteriorColor(e.target.value.slice(0, 100))}
                            maxLength={100}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-sm font-semibold text-[#374151]">Must-Have Features</p>
                          <Textarea
                            data-testid="rv-must-have"
                            placeholder="e.g. Panoramic sunroof, heated seats, Apple CarPlay, third row, backup camera"
                            rows={2}
                            className={AREA_CLS}
                            value={mustHaveFeatures}
                            onChange={(e) => setMustHaveFeatures(e.target.value.slice(0, 1000))}
                            maxLength={1000}
                          />
                          <p className="text-xs text-[#94A3B8]">List features you absolutely cannot compromise on.</p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#374151]">
                            Open to similar alternatives? <span className="text-[#EF4444]">*</span>
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {[
                              { val: true, label: "Yes — show me alternatives" },
                              { val: false, label: "No — this exact vehicle only" },
                            ].map((opt) => {
                              const isSelected = openToAlternatives === opt.val;
                              return (
                                <button
                                  key={String(opt.val)}
                                  type="button"
                                  onClick={() => setOpenToAlternatives(opt.val)}
                                  data-testid={`rv-alternatives-${opt.val ? "yes" : "no"}`}
                                  className={`relative rounded-xl border-2 py-3 px-4 text-sm font-semibold transition-all duration-150 text-left ${
                                    isSelected ? BTN_SELECTED : BTN_IDLE
                                  }`}
                                >
                                  {isSelected && (
                                    <CheckCircle2 size={14} className="absolute top-2.5 right-2.5 text-white/80" />
                                  )}
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Step 3: Financing ── */}
                  {currentStep === 3 && (
                    <>
                      <StepHeader title="Budget &amp; Financing" step={3} />
                      <div className="space-y-5">
                        <div className="space-y-1.5">
                          <p className="text-sm font-semibold text-[#374151]">
                            Total Budget <span className="text-[#EF4444]">*</span>
                          </p>
                          <select
                            data-testid="rv-budget"
                            className={SEL_CLS}
                            style={SEL_STYLE}
                            value={budget}
                            onChange={(e) => setBudget(e.target.value)}
                          >
                            <option value="">Select your budget</option>
                            {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold text-[#374151]">Desired Monthly Payment</p>
                            <select
                              data-testid="rv-monthly-goal"
                              className={SEL_CLS}
                              style={SEL_STYLE}
                              value={desiredMonthlyPayment}
                              onChange={(e) => setDesiredMonthlyPayment(e.target.value)}
                            >
                              <option value="">No preference</option>
                              {MONTHLY_GOALS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold text-[#374151]">Down Payment Available</p>
                            <select
                              data-testid="rv-down-payment-available"
                              className={SEL_CLS}
                              style={SEL_STYLE}
                              value={downPaymentAvailable}
                              onChange={(e) => setDownPaymentAvailable(e.target.value)}
                            >
                              <option value="">No preference</option>
                              {DOWN_AVAILABLE.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-[#374151]">
                            Financing Situation <span className="text-[#EF4444]">*</span>
                          </p>
                          <div className="grid gap-3">
                            {FINANCING_OPTIONS.map((opt) => {
                              const isSelected = financingOption === opt.val;
                              return (
                                <button
                                  key={opt.val}
                                  type="button"
                                  onClick={() => setFinancingOption(opt.val)}
                                  data-testid={`rv-financing-${opt.val}`}
                                  className={`w-full flex items-center justify-between rounded-xl border-2 px-5 py-4 text-left transition-all duration-150 ${
                                    isSelected ? BTN_SELECTED : BTN_IDLE
                                  }`}
                                >
                                  <div>
                                    <p className={`font-bold text-sm ${isSelected ? "text-white" : "text-[#111827]"}`}>
                                      {opt.label}
                                    </p>
                                    <p className={`text-xs mt-0.5 ${isSelected ? "text-white/75" : "text-[#6B7280]"}`}>
                                      {opt.desc}
                                    </p>
                                  </div>
                                  {isSelected
                                    ? <CheckCircle2 size={20} className="text-white/80 shrink-0" />
                                    : <div className="w-5 h-5 rounded-full border-2 border-[#D1D5DB] shrink-0" />
                                  }
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {financingOption === "need_financing" && (
                          <div className="bg-[#F0F7FF] border border-[#BFDBFE] rounded-2xl p-6 space-y-5" data-testid="rv-need-financing-section">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-[#0B5FD1] flex items-center justify-center">
                                <CreditCard size={14} className="text-white" />
                              </div>
                              <p className="text-sm font-bold text-[#0B5FD1]">Financing Profile</p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Employment Status</p>
                                <select
                                  data-testid="rv-employment"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={employmentStatus}
                                  onChange={(e) => setEmploymentStatus(e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {EMPLOYMENT.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Employer Name</p>
                                <Input
                                  data-testid="rv-employer"
                                  placeholder="Company name"
                                  className={INP_CLS}
                                  value={employerName}
                                  onChange={(e) => setEmployerName(e.target.value.slice(0, 100))}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Annual Gross Income</p>
                                <select
                                  data-testid="rv-income"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={annualIncome}
                                  onChange={(e) => setAnnualIncome(e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {INCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Estimated Credit Score</p>
                                <select
                                  data-testid="rv-credit"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={creditScore}
                                  onChange={(e) => setCreditScore(e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {CREDIT.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Desired Down Payment</p>
                                <select
                                  data-testid="rv-down-payment"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={downPayment}
                                  onChange={(e) => setDownPayment(e.target.value)}
                                >
                                  <option value="">No preference</option>
                                  {DOWNS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Monthly Payment Target</p>
                                <select
                                  data-testid="rv-monthly"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={monthlyPayment}
                                  onChange={(e) => setMonthlyPayment(e.target.value)}
                                >
                                  <option value="">No preference</option>
                                  {PAYMENTS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Monthly Gross Income</p>
                                <select
                                  data-testid="rv-monthly-income"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={monthlyIncome}
                                  onChange={(e) => setMonthlyIncome(e.target.value)}
                                >
                                  <option value="">Select range</option>
                                  {MONTHLY_INCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Monthly Housing Payment</p>
                                <select
                                  data-testid="rv-housing-payment"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={housingPayment}
                                  onChange={(e) => setHousingPayment(e.target.value)}
                                >
                                  <option value="">Select range</option>
                                  {HOUSING.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-[#374151]">Co-Buyer?</p>
                              <YesNoToggle
                                value={coBuyer}
                                onChange={setCoBuyer}
                                testIdPrefix="rv-co-buyer"
                              />
                            </div>
                            <p className="text-xs text-[#64748B] bg-white rounded-lg px-3 py-2 border border-[#E2E8F0] flex items-center gap-1.5">
                              <Lock size={11} className="text-[#94A3B8] shrink-0" />
                              Your financial information is encrypted and never shared without your permission.
                            </p>
                          </div>
                        )}

                        {financingOption === "have_financing" && (
                          <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-6 space-y-5" data-testid="rv-have-financing-section">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-[#059669] flex items-center justify-center">
                                <CheckCircle2 size={14} className="text-white" />
                              </div>
                              <p className="text-sm font-bold text-[#059669]">Pre-Approval Details</p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="sm:col-span-2 space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Lender Name</p>
                                <Input
                                  data-testid="rv-lender"
                                  placeholder="Chase Bank, Navy Federal…"
                                  className={INP_CLS}
                                  value={lenderName}
                                  onChange={(e) => setLenderName(e.target.value.slice(0, 100))}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Approved Amount</p>
                                <Input
                                  type="number"
                                  min={0}
                                  data-testid="rv-approved-amount"
                                  placeholder="35000"
                                  className={INP_CLS}
                                  value={approvedAmount}
                                  onChange={(e) => setApprovedAmount(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">APR %</p>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  data-testid="rv-apr"
                                  placeholder="4.5"
                                  className={INP_CLS}
                                  value={apr}
                                  onChange={(e) => setApr(e.target.value)}
                                />
                              </div>
                              <div className="sm:col-span-2 space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Expiry Date</p>
                                <Input
                                  type="date"
                                  data-testid="rv-expiry"
                                  className={INP_CLS}
                                  value={preApprovalExpiry}
                                  onChange={(e) => setPreApprovalExpiry(e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-sm font-semibold text-[#374151]">Upload Pre-Approval Letter</p>
                              <div
                                onClick={() => document.getElementById("pre-approval-upload")?.click()}
                                className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-150 ${
                                  preApprovalFile
                                    ? "border-[#0B5FD1] bg-[#EFF6FF]"
                                    : "border-[#CBD5E1] hover:border-[#0B5FD1]/50 hover:bg-[#F8FAFF]"
                                }`}
                                data-testid="rv-prequal-upload-zone"
                              >
                                <input
                                  id="pre-approval-upload"
                                  type="file"
                                  accept="application/pdf,image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  data-testid="rv-prequal-upload-input"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      if (file.size > 10 * 1024 * 1024) {
                                        alert("File must be under 10MB");
                                        return;
                                      }
                                      setPreApprovalFile(file);
                                    }
                                  }}
                                />
                                {preApprovalFile ? (
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-lg bg-[#0B5FD1]/10 flex items-center justify-center">
                                        <FileText size={20} className="text-[#0B5FD1]" />
                                      </div>
                                      <div className="text-left">
                                        <p className="text-sm font-semibold text-[#0B5FD1]">{preApprovalFile.name}</p>
                                        <p className="text-xs text-[#64748B]">
                                          {(preApprovalFile.size / 1024).toFixed(0)} KB
                                        </p>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setPreApprovalFile(null); }}
                                      className="text-xs text-[#EF4444] hover:underline"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ) : (
                                  <div>
                                    <Upload size={24} className="text-[#94A3B8] mx-auto mb-2" />
                                    <p className="text-sm font-semibold text-[#374151]">Upload pre-approval letter</p>
                                    <p className="text-xs text-[#94A3B8] mt-1">PDF, JPG, PNG · Max 10MB</p>
                                  </div>
                                )}
                              </div>
                              {fileError && (
                                <p className="text-xs text-red-600 mt-2" data-testid="rv-file-error">{fileError}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* ── Step 4: Trade-In ── */}
                  {currentStep === 4 && (
                    <>
                      <StepHeader
                        title="Do you have a trade-in?"
                        subtitle="Skip this step if you don't have a trade-in."
                        step={4}
                      />
                      <div className="space-y-5">
                        <div>
                          <YesNoToggle
                            value={hasTradeIn}
                            onChange={setHasTradeIn}
                            testIdPrefix="rv-trade-in"
                          />
                        </div>

                        {hasTradeIn !== true && (
                          <div className="text-center py-8 text-[#94A3B8]">
                            <p className="text-sm">No trade-in? No problem.</p>
                            <p className="text-xs mt-1">Click Next to continue.</p>
                          </div>
                        )}

                        {hasTradeIn === true && (
                          <div className="space-y-4 border-t border-[#E2E8F0] pt-4" data-testid="trade-in-fields">
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Year <span className="text-[#EF4444]">*</span></p>
                                <select
                                  data-testid="rv-trade-year"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={tradeYear}
                                  onChange={(e) => setTradeYear(e.target.value)}
                                >
                                  <option value="">Year</option>
                                  {TRADE_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Make <span className="text-[#EF4444]">*</span></p>
                                <select
                                  data-testid="rv-trade-make"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={tradeMake}
                                  onChange={(e) => {
                                    setTradeMake(e.target.value);
                                    setTradeModel("");
                                    setTradeModels([]);
                                  }}
                                >
                                  <option value="">Make</option>
                                  {POPULAR_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Model <span className="text-[#EF4444]">*</span></p>
                                {tradeMake === "Other" ? (
                                  <Input
                                    data-testid="rv-trade-model"
                                    className={INP_CLS}
                                    value={tradeModel}
                                    onChange={(e) => setTradeModel(e.target.value)}
                                  />
                                ) : (
                                  <select
                                    data-testid="rv-trade-model"
                                    className={SEL_CLS}
                                    style={SEL_STYLE}
                                    value={tradeModel}
                                    onChange={(e) => setTradeModel(e.target.value)}
                                    disabled={!tradeMake}
                                  >
                                    <option value="">Model</option>
                                    {tradeModels.map((m) => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                )}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-sm font-semibold text-[#374151]">VIN</p>
                              <Input
                                data-testid="rv-trade-vin"
                                placeholder="17-character VIN"
                                maxLength={17}
                                className={INP_CLS}
                                value={tradeVin}
                                onChange={(e) => setTradeVin(e.target.value.toUpperCase().slice(0, 17))}
                              />
                              <p className="text-xs text-[#94A3B8]">Found on dashboard, door jamb, or registration. Helps dealers give accurate trade-in value.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Trim</p>
                                <Input
                                  data-testid="rv-trade-trim"
                                  placeholder="EX, Sport, Limited…"
                                  className={INP_CLS}
                                  value={tradeTrim}
                                  onChange={(e) => setTradeTrim(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Condition <span className="text-[#EF4444]">*</span></p>
                                <select
                                  data-testid="rv-trade-condition"
                                  className={SEL_CLS}
                                  style={SEL_STYLE}
                                  value={tradeCondition}
                                  onChange={(e) => setTradeCondition(e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {TRADE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Mileage <span className="text-[#EF4444]">*</span></p>
                                <Input
                                  type="number"
                                  min={0}
                                  data-testid="rv-trade-mileage"
                                  placeholder="45000"
                                  className={INP_CLS}
                                  value={tradeMileage}
                                  onChange={(e) => setTradeMileage(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Color</p>
                                <Input
                                  data-testid="rv-trade-color"
                                  placeholder="Silver, Black…"
                                  className={INP_CLS}
                                  value={tradeColor}
                                  onChange={(e) => setTradeColor(e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-[#374151]">
                                Is the vehicle paid off? <span className="text-[#EF4444]">*</span>
                              </p>
                              <YesNoToggle
                                value={tradePaidOff}
                                onChange={setTradePaidOff}
                                testIdPrefix="rv-trade-paid"
                              />
                            </div>

                            {tradePaidOff === false && (
                              <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-[#374151]">Remaining Payoff Amount (approx.)</p>
                                <div className="relative">
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8] text-sm font-medium">$</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    data-testid="rv-trade-payoff"
                                    placeholder="8500"
                                    className={`${INP_CLS} pl-8`}
                                    value={tradePayoffAmount}
                                    onChange={(e) => setTradePayoffAmount(e.target.value)}
                                  />
                                </div>
                              </div>
                            )}

                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-[#374151]">
                                Accident History <span className="text-[#EF4444]">*</span>
                              </p>
                              <div className="grid grid-cols-2 gap-2.5">
                                {ACCIDENT_HISTORY.map((opt) => {
                                  const isSelected = tradeAccidentHistory === opt;
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => setTradeAccidentHistory(opt)}
                                      data-testid={`rv-trade-accident-${opt.split(" ")[0].toLowerCase()}`}
                                      className={`relative rounded-xl border-2 py-3 px-4 text-sm font-semibold transition-all duration-150 text-left ${
                                        isSelected ? BTN_SELECTED : BTN_IDLE
                                      }`}
                                    >
                                      {isSelected && (
                                        <CheckCircle2 size={14} className="absolute top-2.5 right-2.5 text-white/80" />
                                      )}
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-sm font-semibold text-[#374151]">Known Issues or Damage</p>
                              <Textarea
                                data-testid="rv-trade-issues"
                                placeholder="Any accidents, mechanical issues, damage…"
                                rows={3}
                                className={AREA_CLS}
                                value={tradeIssues}
                                onChange={(e) => setTradeIssues(e.target.value.slice(0, 1000))}
                                maxLength={1000}
                              />
                            </div>

                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-[#374151]">
                                Title Status <span className="text-[#EF4444]">*</span>
                              </p>
                              <div className="grid grid-cols-4 gap-2">
                                {TITLE_STATUSES.map((opt) => {
                                  const isSelected = tradeTitleStatus === opt.val;
                                  return (
                                    <button
                                      key={opt.val}
                                      type="button"
                                      onClick={() => setTradeTitleStatus(opt.val)}
                                      data-testid={`rv-trade-title-${opt.val}`}
                                      className={`relative rounded-xl border-2 py-3 px-2 text-xs font-semibold transition-all duration-150 text-center ${
                                        isSelected ? BTN_SELECTED : BTN_IDLE
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* ── Step 5: Review ── */}
                  {currentStep === 5 && (
                    <>
                      <StepHeader
                        title="Review your request"
                        subtitle="Everything look right? Edit any section or submit when ready."
                        step={5}
                      />
                      <div className="space-y-3 mb-5">
                        <ReviewCard label="Contact" onEdit={() => jumpTo(1)}>
                          <p className="text-sm font-semibold text-[#111827]">{firstName} {lastName}</p>
                          <p className="text-sm text-[#64748B]">{email} · {phone}</p>
                          <p className="text-sm text-[#64748B]">{city}, {state} {zip}</p>
                          <p className="text-sm text-[#64748B]">{contactMethod || "—"} · {timeline || "—"}</p>
                        </ReviewCard>

                        <ReviewCard label="Vehicle" onEdit={() => jumpTo(2)}>
                          <p className="text-sm font-semibold text-[#111827]">
                            {vehicleType} · {preferredMake || "Any make"} {preferredModel}
                            {preferredMake === "Other" && customMakeModel ? ` (${customMakeModel})` : ""}
                          </p>
                          <p className="text-sm text-[#64748B]">
                            {newOrUsed} · {minYear || "Any"}–{maxYear || "Any"}
                            {interiorColor ? ` · Interior: ${interiorColor}` : ""}
                          </p>
                          <p className="text-sm text-[#64748B]">
                            {openToAlternatives === true ? "Open to alternatives" : openToAlternatives === false ? "Specific vehicle only" : "—"}
                          </p>
                          {mustHaveFeatures && <p className="text-sm text-[#64748B] mt-1">Must-have: {mustHaveFeatures}</p>}
                        </ReviewCard>

                        <ReviewCard label="Financing" onEdit={() => jumpTo(3)}>
                          <p className="text-sm font-semibold text-[#111827]">
                            {financingOption === "need_financing" ? "Needs financing"
                              : financingOption === "have_financing" ? `Pre-approved by ${lenderName || "lender"}`
                              : "Paying cash"}
                          </p>
                          <p className="text-sm text-[#64748B]">
                            Budget: {budget}
                            {desiredMonthlyPayment ? ` · Monthly: ${desiredMonthlyPayment}` : ""}
                            {downPaymentAvailable ? ` · Down: ${downPaymentAvailable}` : ""}
                          </p>
                          {financingOption === "need_financing" && creditScore && (
                            <p className="text-sm text-[#64748B]">Credit: {creditScore}</p>
                          )}
                        </ReviewCard>

                        {hasTradeIn === true && (
                          <ReviewCard label="Trade-In" onEdit={() => jumpTo(4)}>
                            <p className="text-sm font-semibold text-[#111827]">
                              {tradeYear} {tradeMake} {tradeModel}
                            </p>
                            <p className="text-sm text-[#64748B]">
                              {tradeMileage ? `${Number(tradeMileage).toLocaleString()} mi · ` : ""}{tradeCondition || "—"}
                              {tradeAccidentHistory ? ` · ${tradeAccidentHistory}` : ""}
                            </p>
                            {tradeVin && <p className="text-sm text-[#64748B] font-mono text-xs">VIN: {tradeVin}</p>}
                            {tradePaidOff === false && tradePayoffAmount && (
                              <p className="text-sm text-[#64748B]">Payoff: ${Number(tradePayoffAmount).toLocaleString()}</p>
                            )}
                          </ReviewCard>
                        )}
                        {hasTradeIn === false && (
                          <ReviewCard label="Trade-In" onEdit={() => jumpTo(4)}>
                            <p className="text-sm text-[#64748B]">No trade-in</p>
                          </ReviewCard>
                        )}
                        {hasTradeIn === null && (
                          <ReviewCard label="Trade-In" onEdit={() => jumpTo(4)}>
                            <p className="text-sm text-[#64748B]">Not specified</p>
                          </ReviewCard>
                        )}
                      </div>

                      <div className="mb-4 space-y-1.5">
                        <p className="text-sm font-semibold text-[#374151]">Additional Notes</p>
                        <Textarea
                          data-testid="rv-notes"
                          placeholder="Any other details that would help us find your vehicle…"
                          rows={3}
                          className={AREA_CLS}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
                          maxLength={1000}
                        />
                      </div>

                      {/* Required: agree to be contacted about the request + accept the terms.
                          This is NOT SMS-specific — SMS consent is separate and optional below. */}
                      <label className="flex items-start gap-2 cursor-pointer select-none mb-3" data-testid="rv-consent-label">
                        <input
                          type="checkbox"
                          checked={agreedToContact}
                          onChange={(e) => setAgreedToContact(e.target.checked)}
                          data-testid="rv-consent-checkbox"
                          className="h-4 w-4 mt-0.5 rounded border-[#CBD5E1] text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                        />
                        <span className="text-xs text-[#64748B] leading-relaxed">
                          I agree to be contacted by AutoLenis about my vehicle request (by my chosen
                          contact method and email) and I accept the{" "}
                          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Privacy Policy</a>
                          {" "}and{" "}
                          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Terms of Service</a>.
                        </span>
                      </label>

                      {/* Optional, explicit TCPA SMS consent. Unchecked by default and NOT a
                          condition of submitting — persists to consent_sms only when checked. */}
                      <label className="flex items-start gap-2 cursor-pointer select-none mb-4" data-testid="rv-sms-consent-label">
                        <input
                          type="checkbox"
                          checked={smsConsent}
                          onChange={(e) => setSmsConsent(e.target.checked)}
                          data-testid="rv-sms-consent-checkbox"
                          className="h-4 w-4 mt-0.5 rounded border-[#CBD5E1] text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                        />
                        <span className="text-xs text-[#64748B] leading-relaxed">
                          <span className="font-medium text-[#475569]">Optional:</span> I agree to
                          receive recurring automated marketing and account text messages (SMS) from
                          AutoLenis at the phone number I provided, including messages sent by an
                          autodialer. Consent is not a condition of purchase. Message frequency varies;
                          message &amp; data rates may apply. Reply STOP to opt out, HELP for help.
                        </span>
                      </label>

                      {error && (
                        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-2">
                          <p className="text-sm text-red-700" data-testid="rv-error">{error}</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Navigation ── */}
                  <div className="flex items-center gap-4 mt-8 pt-6 border-t border-[#E2E8F0]">
                    {currentStep > 1 && (
                      <button
                        type="button"
                        onClick={handleBack}
                        data-testid="rv-back-btn"
                        className="flex items-center gap-2 text-sm font-semibold text-[#64748B] hover:text-[#374151] transition-colors shrink-0"
                      >
                        <ChevronLeft size={16} /> Back
                      </button>
                    )}
                    {currentStep < TOTAL_STEPS && (
                      <button
                        type="button"
                        onClick={handleNext}
                        disabled={!canProceed}
                        data-testid="rv-next-btn"
                        className="flex-1 h-12 rounded-xl bg-[#0B5FD1] text-white font-bold text-sm hover:bg-[#0944A8] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-md shadow-[#0B5FD1]/20 flex items-center justify-center gap-2"
                      >
                        Continue →
                      </button>
                    )}
                    {currentStep === TOTAL_STEPS && (
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        data-testid="rv-submit"
                        className="flex-1 h-12 rounded-xl bg-[#0B5FD1] text-white font-bold text-sm hover:bg-[#0944A8] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-md shadow-[#0B5FD1]/20 flex items-center justify-center gap-2"
                      >
                        {loading
                          ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
                          : "Submit Vehicle Request →"
                        }
                      </button>
                    )}
                  </div>

                </form>
              </div>
            </div>

            {/* Trust footer */}
            <div className="flex items-center justify-center gap-6 mt-6 text-xs text-[#94A3B8] flex-wrap">
              <span className="flex items-center gap-1.5"><ShieldCheck size={12} /> SSL encrypted</span>
              <span className="flex items-center gap-1.5"><Lock size={12} /> Never sold to dealers</span>
              <span className="flex items-center gap-1.5"><RefreshCw size={12} /> $99 — refund on request</span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

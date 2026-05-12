"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
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

function ProgressBar({ currentStep, total, labels }: { currentStep: number; total: number; labels: string[] }) {
  const pct = Math.round((currentStep / total) * 100);
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-2">
        <p className="text-sm font-medium text-slate-600" data-testid="rv-step-indicator">
          Step {currentStep} of {total}
        </p>
        <p className="text-sm font-semibold text-[#0B5FD1]">{pct}% Complete</p>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
        <div
          className="bg-[#0B5FD1] h-2 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="hidden sm:flex justify-between">
        {labels.map((label, i) => (
          <span key={label} className={`text-xs font-medium ${i + 1 <= currentStep ? "text-[#0B5FD1]" : "text-slate-300"}`}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-bold text-[#111827]">{title}</h2>
      {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ReviewCard({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-1">{label}</p>
          {children}
        </div>
        <button type="button" onClick={onEdit} className="text-xs text-[#0B5FD1] hover:underline shrink-0">
          Edit
        </button>
      </div>
    </div>
  );
}

function SuccessState({ name }: { name: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-10 text-center" data-testid="rv-success">
      <div className="w-16 h-16 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={28} className="text-[#059669]" />
      </div>
      <h3 className="font-bold text-[#111827] text-xl mb-2">Request Received!</h3>
      <p className="text-[#4B5563] mb-6">
        Thank you, {name}. We&apos;ll reach out within 24 hours with next steps.
      </p>
      <a
        href="/"
        data-testid="rv-success-home-link"
        className="inline-flex items-center rounded-lg bg-[#0B5FD1] text-white px-6 py-2.5 text-sm font-medium hover:bg-[#0944a8]"
      >
        Back to AutoLenis
      </a>
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
  const grid = cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-4";
  return (
    <div className={`grid ${grid} gap-2`}>
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            data-testid={`${testIdPrefix}-${opt.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
            className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
              selected
                ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
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
    <main className="min-h-screen bg-[#F8F9FB]" data-testid="request-vehicle-page">
      <section className="bg-white border-b border-[#E5E7EB] py-14 text-center px-4">
        <p className="text-xs font-semibold tracking-widest text-[#0B5FD1] uppercase mb-3">Vehicle Request</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-4">Request Your Perfect Vehicle</h1>
        <p className="text-[#4B5563] max-w-xl mx-auto text-base">
          Tell us what you&apos;re looking for and we&apos;ll connect you with dealers who compete for your business.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-12">
        {submitted ? (
          <SuccessState name={submittedName} />
        ) : (
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-6 md:p-8">
            <ProgressBar currentStep={currentStep} total={TOTAL_STEPS} labels={STEP_LABELS} />
            <form onSubmit={handleSubmit} data-testid="request-vehicle-form">
              {currentStep === 1 && (
                <>
                  <StepHeader title="Tell us about yourself" subtitle="We&rsquo;ll use this to send updates on your request." />
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="rv-first-name">First Name *</Label>
                        <Input id="rv-first-name" data-testid="rv-first-name" placeholder="John" className="mt-1.5" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="rv-last-name">Last Name *</Label>
                        <Input id="rv-last-name" data-testid="rv-last-name" placeholder="Smith" className="mt-1.5" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="rv-email">Email *</Label>
                        <Input id="rv-email" type="email" data-testid="rv-email" placeholder="john@email.com" className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="rv-phone">Phone *</Label>
                        <Input id="rv-phone" type="tel" data-testid="rv-phone" placeholder="(555) 000-0000" className="mt-1.5" value={phone} onChange={(e) => setPhone(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="rv-zip">ZIP Code *</Label>
                      <Input id="rv-zip" data-testid="rv-zip" placeholder="75001" maxLength={5} className="mt-1.5 max-w-[140px]" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} />
                      {zip.length > 0 && !zipValid && <p className="text-xs text-red-600 mt-1">Enter a 5-digit ZIP.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="rv-city">City *</Label>
                        <Input id="rv-city" data-testid="rv-city" placeholder="Dallas" className="mt-1.5" value={city} onChange={(e) => setCity(e.target.value.slice(0, 100))} />
                      </div>
                      <div>
                        <Label htmlFor="rv-state">State *</Label>
                        <Select id="rv-state" data-testid="rv-state" className="w-full mt-1.5" value={state} onChange={(e) => setState(e.target.value)}>
                          <option value="">Select state</option>
                          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="mb-2 block">Preferred Contact Method *</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {CONTACT_METHODS.map((opt) => {
                          const selected = contactMethod === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setContactMethod(opt)}
                              data-testid={`rv-contact-${opt.toLowerCase().replace(" ", "-")}`}
                              className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                                selected
                                  ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                                  : "border-slate-200 text-slate-600 hover:border-slate-300"
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <Label className="mb-2 block">Buying Timeline *</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {TIMELINES.map((opt) => {
                          const selected = timeline === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setTimeline(opt)}
                              data-testid={`rv-timeline-${opt.toLowerCase().replace(/\s+/g, "-")}`}
                              className={`rounded-xl border-2 py-2.5 text-xs font-medium transition-colors ${
                                selected
                                  ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                                  : "border-slate-200 text-slate-600 hover:border-slate-300"
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {currentStep === 2 && (
                <>
                  <StepHeader title="What vehicle are you looking for?" />
                  <div className="space-y-5">
                    <div>
                      <Label className="mb-2 block">Vehicle Type *</Label>
                      <ButtonGroup options={VEHICLE_TYPES} value={vehicleType as typeof VEHICLE_TYPES[number] | ""} onChange={(v) => setVehicleType(v)} testIdPrefix="rv-type" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1.5 block">
                          Make {loadingModels && <span className="text-slate-400 text-xs ml-1">Loading…</span>}
                        </Label>
                        <Select
                          data-testid="rv-make"
                          className="w-full"
                          value={preferredMake}
                          onChange={(e) => {
                            setPreferredMake(e.target.value);
                            setPreferredModel("");
                            setCustomMakeModel("");
                          }}
                        >
                          <option value="">Any Make</option>
                          {POPULAR_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Model</Label>
                        {preferredMake === "Other" ? (
                          <Input
                            data-testid="rv-custom-make-model"
                            placeholder="Enter make and model"
                            value={customMakeModel}
                            onChange={(e) => setCustomMakeModel(e.target.value)}
                          />
                        ) : (
                          <Select
                            data-testid="rv-model"
                            className="w-full"
                            value={preferredModel}
                            onChange={(e) => setPreferredModel(e.target.value)}
                            disabled={!preferredMake || loadingModels}
                          >
                            <option value="">Any Model</option>
                            {models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </Select>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1.5 block">Min Year</Label>
                        <Select data-testid="rv-min-year" className="w-full" value={minYear} onChange={(e) => setMinYear(e.target.value)}>
                          <option value="">No Minimum</option>
                          {REQUEST_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Max Year</Label>
                        <Select data-testid="rv-max-year" className="w-full" value={maxYear} onChange={(e) => setMaxYear(e.target.value)}>
                          <option value="">No Maximum</option>
                          {REQUEST_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="mb-2 block">New or Used? *</Label>
                      <div className="flex gap-2">
                        {NEW_USED.map((opt) => {
                          const selected = newOrUsed === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setNewOrUsed(opt)}
                              data-testid={`rv-new-used-${opt.toLowerCase()}`}
                              className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                                selected
                                  ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <Label className="mb-1.5 block">Specific Features (optional)</Label>
                      <Input
                        data-testid="rv-features"
                        placeholder="e.g. Black exterior, sunroof, third row, AWD…"
                        value={specificFeatures}
                        onChange={(e) => setSpecificFeatures(e.target.value.slice(0, 500))}
                        maxLength={500}
                      />
                    </div>

                    <div>
                      <Label className="mb-1.5 block">Interior Color Preference (optional)</Label>
                      <Input
                        data-testid="rv-interior-color"
                        placeholder="e.g. Black, Beige, Gray"
                        value={interiorColor}
                        onChange={(e) => setInteriorColor(e.target.value.slice(0, 100))}
                        maxLength={100}
                      />
                    </div>

                    <div>
                      <Label className="mb-1.5 block">Must-Have Features (optional)</Label>
                      <Textarea
                        data-testid="rv-must-have"
                        placeholder="e.g. Panoramic sunroof, heated seats, Apple CarPlay, third row, backup camera"
                        rows={2}
                        value={mustHaveFeatures}
                        onChange={(e) => setMustHaveFeatures(e.target.value.slice(0, 1000))}
                        maxLength={1000}
                      />
                      <p className="text-xs text-slate-400 mt-1">List features you absolutely cannot compromise on.</p>
                    </div>

                    <div>
                      <Label className="mb-2 block">Open to similar alternatives? *</Label>
                      <div className="flex gap-2">
                        {[
                          { val: true, label: "Yes — show me alternatives" },
                          { val: false, label: "No — this exact vehicle only" },
                        ].map((opt) => {
                          const selected = openToAlternatives === opt.val;
                          return (
                            <button
                              key={String(opt.val)}
                              type="button"
                              onClick={() => setOpenToAlternatives(opt.val)}
                              data-testid={`rv-alternatives-${opt.val ? "yes" : "no"}`}
                              className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-colors text-left ${
                                selected
                                  ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                                  : "border-slate-200 text-slate-600 hover:border-slate-300"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <StepHeader title="Budget &amp; Financing" />
                  <div className="space-y-5">
                    <div>
                      <Label className="mb-1.5 block">Total Budget *</Label>
                      <Select data-testid="rv-budget" className="w-full" value={budget} onChange={(e) => setBudget(e.target.value)}>
                        <option value="">Select your budget</option>
                        {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </Select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1.5 block">Desired Monthly Payment (optional)</Label>
                        <Select data-testid="rv-monthly-goal" className="w-full" value={desiredMonthlyPayment} onChange={(e) => setDesiredMonthlyPayment(e.target.value)}>
                          <option value="">No preference</option>
                          {MONTHLY_GOALS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Down Payment Available (optional)</Label>
                        <Select data-testid="rv-down-payment-available" className="w-full" value={downPaymentAvailable} onChange={(e) => setDownPaymentAvailable(e.target.value)}>
                          <option value="">No preference</option>
                          {DOWN_AVAILABLE.map((o) => <option key={o} value={o}>{o}</option>)}
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="mb-2 block">Financing Situation *</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {FINANCING_OPTIONS.map((opt) => {
                          const selected = financingOption === opt.val;
                          return (
                            <button
                              key={opt.val}
                              type="button"
                              onClick={() => setFinancingOption(opt.val)}
                              data-testid={`rv-financing-${opt.val}`}
                              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                                selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5" : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <p className={`text-sm font-semibold mb-0.5 ${selected ? "text-[#0B5FD1]" : "text-slate-700"}`}>
                                {opt.label}
                              </p>
                              <p className="text-xs text-slate-400">{opt.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {financingOption === "need_financing" && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4" data-testid="rv-need-financing-section">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Pre-Qualification Info</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <Label className="mb-1.5 block">Employment Status</Label>
                            <Select data-testid="rv-employment" className="w-full" value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)}>
                              <option value="">Select</option>
                              {EMPLOYMENT.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Employer Name</Label>
                            <Input data-testid="rv-employer" placeholder="Company name" value={employerName} onChange={(e) => setEmployerName(e.target.value.slice(0, 100))} />
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Annual Gross Income</Label>
                            <Select data-testid="rv-income" className="w-full" value={annualIncome} onChange={(e) => setAnnualIncome(e.target.value)}>
                              <option value="">Select</option>
                              {INCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Estimated Credit Score</Label>
                            <Select data-testid="rv-credit" className="w-full" value={creditScore} onChange={(e) => setCreditScore(e.target.value)}>
                              <option value="">Select</option>
                              {CREDIT.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Desired Down Payment</Label>
                            <Select data-testid="rv-down-payment" className="w-full" value={downPayment} onChange={(e) => setDownPayment(e.target.value)}>
                              <option value="">No preference</option>
                              {DOWNS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Monthly Payment Target</Label>
                            <Select data-testid="rv-monthly" className="w-full" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)}>
                              <option value="">No preference</option>
                              {PAYMENTS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Monthly Gross Income</Label>
                            <Select data-testid="rv-monthly-income" className="w-full" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value)}>
                              <option value="">Select range</option>
                              {MONTHLY_INCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Monthly Housing Payment</Label>
                            <Select data-testid="rv-housing-payment" className="w-full" value={housingPayment} onChange={(e) => setHousingPayment(e.target.value)}>
                              <option value="">Select range</option>
                              {HOUSING.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          </div>
                        </div>
                        <div>
                          <Label className="mb-2 block">Co-Buyer?</Label>
                          <div className="flex gap-2">
                            {["Yes", "No"].map((opt) => {
                              const selected = coBuyer === (opt === "Yes");
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setCoBuyer(opt === "Yes")}
                                  data-testid={`rv-co-buyer-${opt.toLowerCase()}`}
                                  className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                                    selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]" : "border-slate-200 text-slate-600 hover:border-slate-300"
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 bg-white rounded-lg px-3 py-2 border border-slate-100">
                          🔒 Your financial information is encrypted and never shared without your permission.
                        </p>
                      </div>
                    )}

                    {financingOption === "have_financing" && (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4" data-testid="rv-have-financing-section">
                        <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Pre-Approval Details</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="sm:col-span-2">
                            <Label className="mb-1.5 block">Lender Name *</Label>
                            <Input data-testid="rv-lender" placeholder="Chase Bank, Navy Federal…" value={lenderName} onChange={(e) => setLenderName(e.target.value.slice(0, 100))} />
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Approved Amount *</Label>
                            <Input type="number" min={0} data-testid="rv-approved-amount" placeholder="35000" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
                          </div>
                          <div>
                            <Label className="mb-1.5 block">APR %</Label>
                            <Input type="number" step="0.01" min={0} data-testid="rv-apr" placeholder="4.5" value={apr} onChange={(e) => setApr(e.target.value)} />
                          </div>
                          <div className="sm:col-span-2">
                            <Label className="mb-1.5 block">Expiry Date</Label>
                            <Input type="date" data-testid="rv-expiry" value={preApprovalExpiry} onChange={(e) => setPreApprovalExpiry(e.target.value)} />
                          </div>
                        </div>

                        <div>
                          <Label className="mb-1.5 block">Upload Pre-Approval Letter (optional)</Label>
                          <label
                            htmlFor="rv-upload-input"
                            data-testid="rv-upload-zone"
                            className="block border-2 border-dashed border-green-200 rounded-xl p-5 text-center cursor-pointer hover:border-[#0B5FD1]/40 bg-white"
                          >
                            <input
                              id="rv-upload-input"
                              data-testid="rv-upload-input"
                              type="file"
                              accept="application/pdf,image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                            />
                            <Upload size={18} className="text-slate-400 mx-auto mb-1" />
                            {preApprovalFile ? (
                              <p className="text-sm text-slate-700 font-medium">{preApprovalFile.name}</p>
                            ) : (
                              <p className="text-sm text-slate-400">Click to upload — PDF, JPG, PNG up to 10 MB</p>
                            )}
                          </label>
                          {fileError && <p className="text-xs text-red-600 mt-2" data-testid="rv-file-error">{fileError}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {currentStep === 4 && (
                <>
                  <StepHeader title="Do you have a trade-in?" subtitle="Optional — skip if not applicable." />
                  <div className="space-y-5">
                    <div className="flex gap-2">
                      {(["Yes", "No"] as const).map((opt) => {
                        const selected = (opt === "Yes" && hasTradeIn === true) || (opt === "No" && hasTradeIn === false);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setHasTradeIn(opt === "Yes")}
                            data-testid={`rv-trade-in-${opt.toLowerCase()}`}
                            className={`flex-1 h-12 rounded-xl border-2 text-sm font-medium transition-colors ${
                              selected
                                ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]"
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {hasTradeIn !== true && (
                      <div className="text-center py-8 text-slate-400">
                        <p className="text-sm">No trade-in? No problem.</p>
                        <p className="text-xs mt-1">Click Next to continue.</p>
                      </div>
                    )}

                    {hasTradeIn === true && (
                      <div className="space-y-4 border-t border-slate-100 pt-4">
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="mb-1.5 block">Year *</Label>
                            <Select data-testid="rv-trade-year" className="w-full" value={tradeYear} onChange={(e) => setTradeYear(e.target.value)}>
                              <option value="">Year</option>
                              {TRADE_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Make *</Label>
                            <Select
                              data-testid="rv-trade-make"
                              className="w-full"
                              value={tradeMake}
                              onChange={(e) => {
                                setTradeMake(e.target.value);
                                setTradeModel("");
                              }}
                            >
                              <option value="">Make</option>
                              {POPULAR_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Model *</Label>
                            {tradeMake === "Other" ? (
                              <Input data-testid="rv-trade-model" value={tradeModel} onChange={(e) => setTradeModel(e.target.value)} />
                            ) : (
                              <Select
                                data-testid="rv-trade-model"
                                className="w-full"
                                value={tradeModel}
                                onChange={(e) => setTradeModel(e.target.value)}
                                disabled={!tradeMake}
                              >
                                <option value="">Model</option>
                                {tradeModels.map((m) => <option key={m} value={m}>{m}</option>)}
                              </Select>
                            )}
                          </div>
                        </div>

                        <div>
                          <Label className="mb-1.5 block">VIN (optional)</Label>
                          <Input
                            data-testid="rv-trade-vin"
                            placeholder="17-character VIN"
                            maxLength={17}
                            value={tradeVin}
                            onChange={(e) => setTradeVin(e.target.value.toUpperCase().slice(0, 17))}
                          />
                          <p className="text-xs text-slate-400 mt-1">Found on dashboard, door jamb, or registration. Helps dealers give accurate trade-in value.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="mb-1.5 block">Trim</Label>
                            <Input data-testid="rv-trade-trim" placeholder="EX, Sport, Limited…" value={tradeTrim} onChange={(e) => setTradeTrim(e.target.value)} />
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Condition *</Label>
                            <Select data-testid="rv-trade-condition" className="w-full" value={tradeCondition} onChange={(e) => setTradeCondition(e.target.value)}>
                              <option value="">Select</option>
                              {TRADE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Mileage *</Label>
                            <Input type="number" min={0} data-testid="rv-trade-mileage" placeholder="45000" value={tradeMileage} onChange={(e) => setTradeMileage(e.target.value)} />
                          </div>
                          <div>
                            <Label className="mb-1.5 block">Color</Label>
                            <Input data-testid="rv-trade-color" placeholder="Silver, Black…" value={tradeColor} onChange={(e) => setTradeColor(e.target.value)} />
                          </div>
                        </div>

                        <div>
                          <Label className="mb-2 block">Is the vehicle paid off? *</Label>
                          <div className="flex gap-2">
                            {(["Yes", "No"] as const).map((opt) => {
                              const selected = tradePaidOff === (opt === "Yes");
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setTradePaidOff(opt === "Yes")}
                                  data-testid={`rv-trade-paid-${opt.toLowerCase()}`}
                                  className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                                    selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]" : "border-slate-200 text-slate-600 hover:border-slate-300"
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {tradePaidOff === false && (
                          <div>
                            <Label className="mb-1.5 block">Remaining Payoff Amount (approx.)</Label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                              <Input
                                type="number"
                                min={0}
                                data-testid="rv-trade-payoff"
                                placeholder="8500"
                                className="pl-7"
                                value={tradePayoffAmount}
                                onChange={(e) => setTradePayoffAmount(e.target.value)}
                              />
                            </div>
                          </div>
                        )}

                        <div>
                          <Label className="mb-2 block">Accident History *</Label>
                          <div className="grid grid-cols-2 gap-2">
                            {ACCIDENT_HISTORY.map((opt) => {
                              const selected = tradeAccidentHistory === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setTradeAccidentHistory(opt)}
                                  data-testid={`rv-trade-accident-${opt.split(" ")[0].toLowerCase()}`}
                                  className={`rounded-xl border-2 py-2.5 text-xs font-medium transition-colors ${
                                    selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]" : "border-slate-200 text-slate-600 hover:border-slate-300"
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <Label className="mb-1.5 block">Known Issues or Damage (optional)</Label>
                          <Textarea
                            data-testid="rv-trade-issues"
                            placeholder="Any accidents, mechanical issues, damage…"
                            rows={3}
                            value={tradeIssues}
                            onChange={(e) => setTradeIssues(e.target.value.slice(0, 1000))}
                            maxLength={1000}
                          />
                        </div>

                        <div>
                          <Label className="mb-2 block">Title Status *</Label>
                          <div className="grid grid-cols-4 gap-2">
                            {TITLE_STATUSES.map((opt) => {
                              const selected = tradeTitleStatus === opt.val;
                              return (
                                <button
                                  key={opt.val}
                                  type="button"
                                  onClick={() => setTradeTitleStatus(opt.val)}
                                  data-testid={`rv-trade-title-${opt.val}`}
                                  className={`rounded-xl border-2 py-2.5 text-xs font-medium transition-colors ${
                                    selected ? "border-[#0B5FD1] bg-[#0B5FD1]/5 text-[#0B5FD1]" : "border-slate-200 text-slate-600 hover:border-slate-300"
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

              {currentStep === 5 && (
                <>
                  <StepHeader title="Review your request" subtitle="Everything look right? Edit any section or submit when ready." />
                  <div className="space-y-3 mb-5">
                    <ReviewCard label="Contact" onEdit={() => jumpTo(1)}>
                      <p className="text-sm font-semibold text-slate-800">{firstName} {lastName}</p>
                      <p className="text-sm text-slate-500">{email} · {phone}</p>
                      <p className="text-sm text-slate-500">{city}, {state} {zip}</p>
                      <p className="text-sm text-slate-500">{contactMethod || "—"} · {timeline || "—"}</p>
                    </ReviewCard>

                    <ReviewCard label="Vehicle" onEdit={() => jumpTo(2)}>
                      <p className="text-sm font-semibold text-slate-800">
                        {vehicleType} · {preferredMake || "Any make"} {preferredModel}
                        {preferredMake === "Other" && customMakeModel ? ` (${customMakeModel})` : ""}
                      </p>
                      <p className="text-sm text-slate-500">
                        {newOrUsed} · {minYear || "Any"}–{maxYear || "Any"}
                        {interiorColor ? ` · Interior: ${interiorColor}` : ""}
                      </p>
                      <p className="text-sm text-slate-500">
                        {openToAlternatives === true ? "Open to alternatives" : openToAlternatives === false ? "Specific vehicle only" : "—"}
                      </p>
                      {mustHaveFeatures && <p className="text-sm text-slate-500 mt-1">Must-have: {mustHaveFeatures}</p>}
                    </ReviewCard>

                    <ReviewCard label="Financing" onEdit={() => jumpTo(3)}>
                      <p className="text-sm font-semibold text-slate-800">
                        {financingOption === "need_financing" ? "Needs financing"
                          : financingOption === "have_financing" ? `Pre-approved by ${lenderName || "lender"}`
                          : "Paying cash"}
                      </p>
                      <p className="text-sm text-slate-500">
                        Budget: {budget}
                        {desiredMonthlyPayment ? ` · Monthly: ${desiredMonthlyPayment}` : ""}
                        {downPaymentAvailable ? ` · Down: ${downPaymentAvailable}` : ""}
                      </p>
                      {financingOption === "need_financing" && creditScore && (
                        <p className="text-sm text-slate-500">Credit: {creditScore}</p>
                      )}
                    </ReviewCard>

                    {hasTradeIn === true && (
                      <ReviewCard label="Trade-In" onEdit={() => jumpTo(4)}>
                        <p className="text-sm font-semibold text-slate-800">
                          {tradeYear} {tradeMake} {tradeModel}
                        </p>
                        <p className="text-sm text-slate-500">
                          {tradeMileage ? `${Number(tradeMileage).toLocaleString()} mi · ` : ""}{tradeCondition || "—"}
                          {tradeAccidentHistory ? ` · ${tradeAccidentHistory}` : ""}
                        </p>
                        {tradeVin && <p className="text-sm text-slate-500 font-mono text-xs">VIN: {tradeVin}</p>}
                        {tradePaidOff === false && tradePayoffAmount && (
                          <p className="text-sm text-slate-500">Payoff: ${Number(tradePayoffAmount).toLocaleString()}</p>
                        )}
                      </ReviewCard>
                    )}
                    {hasTradeIn === false && (
                      <ReviewCard label="Trade-In" onEdit={() => jumpTo(4)}>
                        <p className="text-sm text-slate-500">No trade-in</p>
                      </ReviewCard>
                    )}
                    {hasTradeIn === null && (
                      <ReviewCard label="Trade-In" onEdit={() => jumpTo(4)}>
                        <p className="text-sm text-slate-500">Not specified</p>
                      </ReviewCard>
                    )}
                  </div>

                  <div className="mb-4">
                    <Label className="mb-1.5 block">Additional Notes (optional)</Label>
                    <Textarea
                      data-testid="rv-notes"
                      placeholder="Any other details that would help us find your vehicle…"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
                      maxLength={1000}
                    />
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer select-none mb-4" data-testid="rv-consent-label">
                    <input
                      type="checkbox"
                      checked={agreedToContact}
                      onChange={(e) => setAgreedToContact(e.target.checked)}
                      data-testid="rv-consent-checkbox"
                      className="h-4 w-4 mt-0.5 rounded border-slate-300 text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
                    />
                    <span className="text-xs text-slate-600 leading-relaxed">
                      I agree to be contacted by AutoLenis about my vehicle request. My information will not be shared without my consent.
                    </span>
                  </label>

                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mb-2">
                      <p className="text-sm text-red-700" data-testid="rv-error">{error}</p>
                    </div>
                  )}
                </>
              )}

              {/* Navigation */}
              <div className="flex gap-3 mt-8 pt-6 border-t border-slate-100">
                {currentStep > 1 && (
                  <button
                    type="button"
                    onClick={handleBack}
                    data-testid="rv-back-btn"
                    className="flex-1 h-12 rounded-xl border-2 border-slate-200 text-slate-600 text-sm font-semibold hover:border-slate-300 hover:bg-slate-50 transition-colors"
                  >
                    ← Back
                  </button>
                )}
                {currentStep < TOTAL_STEPS && (
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!canProceed}
                    data-testid="rv-next-btn"
                    className={`flex-1 h-12 rounded-xl text-sm font-semibold transition-colors ${
                      canProceed
                        ? "bg-[#0B5FD1] text-white hover:bg-[#0944a8]"
                        : "bg-slate-100 text-slate-400 cursor-not-allowed"
                    }`}
                  >
                    Next →
                  </button>
                )}
                {currentStep === TOTAL_STEPS && (
                  <Button
                    type="submit"
                    className="flex-1 h-12 text-sm font-semibold"
                    disabled={!canSubmit}
                    data-testid="rv-submit"
                  >
                    {loading ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting…</> : "Submit Request →"}
                  </Button>
                )}
              </div>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

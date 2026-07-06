"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Building2, FileText, Truck, ClipboardCheck } from "lucide-react";

const STEPS = [
  { id: "BUSINESS_INFO", label: "Business Info", icon: Building2 },
  { id: "LICENSE", label: "License", icon: FileText },
  { id: "INVENTORY", label: "Inventory Setup", icon: Truck },
  { id: "AGREEMENT", label: "Agreement", icon: ClipboardCheck },
] as const;

type StepId = typeof STEPS[number]["id"];

function StepIndicator({ current, completed }: { current: number; completed: number[] }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isDone = completed.includes(i);
        const isCurrent = i === current;
        return (
          <div key={step.id} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors
              ${isDone ? "bg-[#059669] text-white" : isCurrent ? "bg-al-primary text-white" : "bg-[#E2E8F0] text-[#94A3B8]"}`}>
              {isDone ? <CheckCircle size={16} /> : <Icon size={14} />}
            </div>
            <span className={`ml-1.5 text-xs hidden sm:inline ${isCurrent ? "text-al-primary font-semibold" : "text-[#94A3B8]"}`}>
              {step.label}
            </span>
            {i < STEPS.length - 1 && <div className={`w-6 h-px mx-2 ${isDone ? "bg-[#059669]" : "bg-[#E2E8F0]"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default function DealerOnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Form state per step
  const [business, setBusiness] = useState({ dealershipName: "", phone: "", address: "", city: "", state: "", zip: "" });
  const [license, setLicense] = useState({ licenseNumber: "" });
  const [inventory, setInventory] = useState({ feedUrl: "" });
  const [agreed, setAgreed] = useState(false);

  // Hydrate previously persisted onboarding values so refresh does not lose progress.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dealer/onboarding")
      .then((r) => r.json())
      .then((d: { success?: boolean; data?: {
        dealershipName?: string | null; phone?: string | null; address?: string | null;
        city?: string | null; state?: string | null; zip?: string | null;
        licenseNumber?: string | null; agreedToTermsAt?: string | null;
        onboardingStep?: string | null;
      } }) => {
        if (cancelled) return;
        const data = d?.data;
        if (d?.success && data) {
          if (data.dealershipName) {
            setBusiness((b) => ({
              ...b,
              dealershipName: data.dealershipName ?? b.dealershipName,
              phone: data.phone ?? b.phone,
              address: data.address ?? b.address,
              city: data.city ?? b.city,
              state: data.state ?? b.state,
              zip: data.zip ?? b.zip,
            }));
          }
          if (data.licenseNumber) {
            setLicense({ licenseNumber: data.licenseNumber });
          }
          // Reconstruct completed steps from persisted fields.
          const done: number[] = [];
          if (data.dealershipName && data.phone && data.address) done.push(0);
          if (data.licenseNumber) done.push(1);
          // INVENTORY step is optional — once LICENSE is saved the server has
          // already advanced past inventory by the time AGREEMENT is recorded.
          if (data.onboardingStep === "AGREEMENT" || data.onboardingStep === "COMPLETE") {
            if (!done.includes(2)) done.push(2);
          }
          if (data.agreedToTermsAt || data.onboardingStep === "COMPLETE") {
            setAgreed(true);
            if (!done.includes(3)) done.push(3);
          }
          setCompleted(done);
          if (done.length > 0) {
            setCurrentStep(Math.min(done.length, STEPS.length - 1));
          }
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => { cancelled = true; };
  }, []);

  async function submitStep(stepId: StepId, payload: Record<string, unknown>) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/dealer/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepId, ...payload }),
      });
      const data = await res.json() as { success?: boolean; error?: string; redirect?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
      } else {
        if (data.redirect) {
          router.push(data.redirect);
          return;
        }
        setCompleted((prev) => [...prev, currentStep]);
        setCurrentStep((prev) => prev + 1);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Loading state while hydrating to prevent overwriting persisted values on first render.
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-al-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const inputClass = "w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-3 text-[#111827] placeholder-[#94A3B8] text-sm focus:outline-none focus:ring-2 focus:ring-al-primary";
  const ctaClass = "w-full bg-al-primary hover:bg-al-primary-hover disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm";

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#111827]">Complete Your Setup</h1>
          <p className="text-[#4B5563] text-sm mt-1">4 quick steps to activate your dealer account</p>
        </div>

        <StepIndicator current={currentStep} completed={completed} />

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 shadow-sm">
          {error && (
            <div data-testid="onboarding-error" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>
          )}

          {/* Step 0: Business Info */}
          {currentStep === 0 && (
            <form onSubmit={(e) => { e.preventDefault(); submitStep("BUSINESS_INFO", business); }} className="space-y-4">
              <h2 className="text-lg font-semibold text-[#111827] mb-4">Business Information</h2>
              <input data-testid="ob-dealership-name" placeholder="Dealership Name*" value={business.dealershipName} onChange={e => setBusiness(b => ({...b, dealershipName: e.target.value}))} required className={inputClass} />
              <input data-testid="ob-phone" placeholder="Phone Number*" value={business.phone} onChange={e => setBusiness(b => ({...b, phone: e.target.value}))} required className={inputClass} />
              <input data-testid="ob-address" placeholder="Street Address*" value={business.address} onChange={e => setBusiness(b => ({...b, address: e.target.value}))} required className={inputClass} />
              <div className="grid grid-cols-3 gap-3">
                <input data-testid="ob-city" placeholder="City*" value={business.city} onChange={e => setBusiness(b => ({...b, city: e.target.value}))} required className={`col-span-1 ${inputClass}`} />
                <input data-testid="ob-state" placeholder="ST" maxLength={2} value={business.state} onChange={e => setBusiness(b => ({...b, state: e.target.value.toUpperCase()}))} required className={`col-span-1 ${inputClass}`} />
                <input data-testid="ob-zip" placeholder="ZIP*" value={business.zip} onChange={e => setBusiness(b => ({...b, zip: e.target.value}))} required className={`col-span-1 ${inputClass}`} />
              </div>
              <button data-testid="ob-next-business" type="submit" disabled={loading} className={ctaClass}>{loading ? "Saving..." : "Continue"}</button>
            </form>
          )}

          {/* Step 1: License */}
          {currentStep === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); submitStep("LICENSE", license); }} className="space-y-4">
              <h2 className="text-lg font-semibold text-[#111827] mb-4">Dealer License</h2>
              <p className="text-[#4B5563] text-sm">Enter your official dealer license number for compliance verification.</p>
              <input data-testid="ob-license-number" placeholder="Dealer License Number*" value={license.licenseNumber} onChange={e => setLicense({ licenseNumber: e.target.value })} required className={inputClass} />
              <button data-testid="ob-next-license" type="submit" disabled={loading} className={ctaClass}>{loading ? "Saving..." : "Continue"}</button>
            </form>
          )}

          {/* Step 2: Inventory Setup */}
          {currentStep === 2 && (
            <form onSubmit={(e) => { e.preventDefault(); submitStep("INVENTORY", inventory); }} className="space-y-4">
              <h2 className="text-lg font-semibold text-[#111827] mb-4">Inventory Setup</h2>
              <p className="text-[#4B5563] text-sm">Optionally provide a feed URL to automatically sync your inventory. You can also add vehicles manually from your dashboard.</p>
              <input data-testid="ob-feed-url" placeholder="Inventory Feed URL (optional)" type="url" value={inventory.feedUrl} onChange={e => setInventory({ feedUrl: e.target.value })} className={inputClass} />
              <button data-testid="ob-next-inventory" type="submit" disabled={loading} className={ctaClass}>{loading ? "Saving..." : "Continue"}</button>
            </form>
          )}

          {/* Step 3: Agreement */}
          {currentStep === 3 && (
            <form onSubmit={(e) => { e.preventDefault(); if (agreed) submitStep("AGREEMENT", { agreedToTerms: true }); }} className="space-y-4">
              <h2 className="text-lg font-semibold text-[#111827] mb-4">Dealer Agreement</h2>
              <div className="bg-[#F8F9FB] border border-[#E2E8F0] rounded-lg p-4 max-h-48 overflow-y-auto text-[#4B5563] text-xs leading-relaxed">
                <p className="font-semibold text-[#111827] mb-2">AutoLenis Dealer Network Agreement</p>
                <p>By joining the AutoLenis Dealer Network, you agree to: (1) provide accurate vehicle listings and pricing; (2) respond promptly to buyer inquiries; (3) comply with all applicable state and federal regulations; (4) maintain your dealer license in good standing; (5) abide by AutoLenis marketplace policies. AutoLenis reserves the right to suspend or terminate accounts that violate these terms. Your account data is governed by the AutoLenis Privacy Policy.</p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input data-testid="ob-agree-checkbox" type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-[#E2E8F0] bg-white accent-al-primary" />
                <span className="text-[#374151] text-sm">I have read and agree to the AutoLenis Dealer Network Agreement</span>
              </label>
              <button data-testid="ob-complete" type="submit" disabled={loading || !agreed} className={ctaClass}>{loading ? "Activating..." : "Complete Setup & Activate Account"}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// Buyer onboarding — profile preferences only.
// No credit checks, no FCRA consent, no MicroBilt, no DOB/address/employment.
// Those live exclusively on /buyer/prequal.
//
// This wizard collects:
//   1. Vehicle type preference (icon-card selector)
//   2. New / used preference (two-option toggle)
//   3. Communication preferences (email notifications on/off)
//   4. Phone number, ONLY if not already on file
//
// On completion the buyer is routed to /buyer/prequal.

import { useState, useMemo, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight, Car, Truck, Bus, Zap, MoreHorizontal, CheckCircle2 } from "lucide-react";

// ─── Onboarding Progress Indicator ──────────────────────────────────────────
// Shows the buyer's position in the 3-step pre-journey:
//   Step 1: Account created (always complete by the time this page is shown)
//   Step 2: Profile setup (current)
//   Step 3: Pre-Qualification (next)

const ONBOARDING_STEPS = [
  { id: 1, label: "Account" },
  { id: 2, label: "Profile Setup" },
  { id: 3, label: "Pre-Qualification" },
] as const;

function OnboardingProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <div
      className="mb-8 px-2"
      data-testid="onboarding-progress-bar"
      role="progressbar"
      aria-valuenow={currentStep}
      aria-valuemin={1}
      aria-valuemax={ONBOARDING_STEPS.length}
      aria-label={`Onboarding step ${currentStep} of ${ONBOARDING_STEPS.length}`}
    >
      <div className="flex items-center gap-0">
        {ONBOARDING_STEPS.map((step, idx) => {
          const done = step.id < currentStep;
          const active = step.id === currentStep;
          const isLast = idx === ONBOARDING_STEPS.length - 1;
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                    done
                      ? "bg-al-primary border-al-primary text-white"
                      : active
                      ? "bg-white border-al-primary text-al-primary"
                      : "bg-white border-slate-200 text-slate-400"
                  }`}
                  data-testid={`onboarding-step-${step.id}`}
                >
                  {done ? <CheckCircle2 size={14} /> : step.id}
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium text-center whitespace-nowrap ${
                    done ? "text-al-primary" : active ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${
                    done ? "bg-al-primary" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type VehicleType = "SUV" | "Sedan" | "Truck" | "Van" | "Coupe" | "Other";
type NewOrUsed = "NEW" | "USED";

const VEHICLE_TYPES: ReadonlyArray<{ id: VehicleType; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: "SUV", label: "SUV", icon: Car },
  { id: "Sedan", label: "Sedan", icon: Car },
  { id: "Truck", label: "Truck", icon: Truck },
  { id: "Van", label: "Van", icon: Bus },
  { id: "Coupe", label: "Coupe", icon: Zap },
  { id: "Other", label: "Other", icon: MoreHorizontal },
];

interface BuyerInitial {
  firstName: string;
  lastName: string;
  phone: string;
  onboardingComplete: boolean;
}

export default function OnboardingWizardClient({ initial }: { initial: BuyerInitial }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const phoneAlreadySet = useMemo(() => initial.phone.trim().length > 0, [initial.phone]);
  const nameAlreadySet = useMemo(
    () => initial.firstName.trim().length > 0 && initial.lastName.trim().length > 0,
    [initial.firstName, initial.lastName],
  );

  const [vehicleType, setVehicleType] = useState<VehicleType | "">("");
  const [newOrUsed, setNewOrUsed] = useState<NewOrUsed | "">("");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [firstName, setFirstName] = useState(initial.firstName ?? "");
  const [lastName, setLastName] = useState(initial.lastName ?? "");
  const [smsConsent, setSmsConsent] = useState(false);

  const phoneValid = !phoneAlreadySet ? phone.replace(/\D/g, "").length >= 10 : true;
  const nameValid = nameAlreadySet || (firstName.trim().length > 0 && lastName.trim().length > 0);
  const phoneIsBeingCollected = !phoneAlreadySet && phone.trim().length > 0;
  const canSubmit =
    vehicleType !== "" &&
    newOrUsed !== "" &&
    phoneValid &&
    nameValid &&
    !submitting &&
    (!phoneIsBeingCollected || smsConsent);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    try {
      // 1. Persist name + phone if newly entered
      if (!phoneAlreadySet && phone.trim() || !nameAlreadySet) {
        const profileRes = await fetch("/api/buyer/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: firstName.trim() || initial.firstName,
            lastName: lastName.trim() || initial.lastName,
            ...(!phoneAlreadySet && phone.trim() ? { phone: phone.trim() } : {}),
          }),
        });
        if (!profileRes.ok) {
          const data = (await profileRes.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(data.error?.message ?? "Could not save your profile");
        }
      }

      // 2. Persist preferences (vehicle type + new/used + email notifications)
      const prefsRes = await fetch("/api/buyer/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailNotifications,
          vehicleTypePreference: vehicleType,
          newOrUsedPreference: newOrUsed,
        }),
      });
      if (!prefsRes.ok) {
        const data = (await prefsRes.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "Could not save your preferences");
      }

      // 3. Mark onboarding complete (no FCRA / MicroBilt call)
      const completeRes = await fetch("/api/buyer/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      if (!completeRes.ok) {
        const data = (await completeRes.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "Could not complete onboarding");
      }

      // 4. Route to pre-qualification — onboarding ≠ prequal
      router.push("/buyer/prequal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="px-4 py-8 sm:px-6 md:px-8 md:py-10" data-testid="onboarding-wizard">
      <div className="mx-auto w-full max-w-2xl">
        {/* Feature 9 — Onboarding Progress Indicator */}
        <OnboardingProgressBar currentStep={2} />

        <header className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Welcome to AutoLenis</h1>
          <p className="mt-2 text-sm sm:text-base text-slate-500">
            A few quick preferences so we can tailor your experience.
          </p>
        </header>

        <form onSubmit={handleSubmit} data-testid="onboarding-form" className="space-y-10">
          {/* ── Name — only when missing ────────────────────────────── */}
          {!nameAlreadySet && (
            <section data-testid="onboarding-name-section">
              <h2 className="text-base font-semibold text-slate-900 mb-4">Your name</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1.5 block">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={submitting}
                    data-testid="onboarding-first-name"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-al-primary focus:ring-2 focus:ring-al-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1.5 block">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={submitting}
                    data-testid="onboarding-last-name"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-al-primary focus:ring-2 focus:ring-al-primary/20"
                    required
                  />
                </div>
              </div>
            </section>
          )}

          {/* ── Vehicle type ──────────────────────────────────────────── */}
          <section data-testid="onboarding-vehicle-type">
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              What kind of vehicle are you looking for?
            </h2>
            <p className="text-xs text-slate-500 mb-4">Pick the option that best matches your needs.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {VEHICLE_TYPES.map(({ id, label, icon: Icon }) => {
                const selected = vehicleType === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVehicleType(id)}
                    disabled={submitting}
                    data-testid={`onboarding-vehicle-${id.toLowerCase()}`}
                    aria-pressed={selected}
                    className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 p-5 transition-all ${
                      selected
                        ? "border-al-primary bg-al-primary/5 text-al-primary"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <Icon size={36} className={selected ? "text-al-primary" : "text-slate-500"} />
                    <span className="text-sm font-medium">{label}</span>
                    {selected && <CheckCircle2 size={14} className="text-al-primary" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── New or used toggle ─────────────────────────────────────── */}
          <section data-testid="onboarding-new-or-used">
            <h2 className="text-base font-semibold text-slate-900 mb-4">New or used?</h2>
            <div className="grid grid-cols-2 gap-3">
              {(["NEW", "USED"] as const).map((opt) => {
                const selected = newOrUsed === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setNewOrUsed(opt)}
                    disabled={submitting}
                    data-testid={`onboarding-condition-${opt.toLowerCase()}`}
                    aria-pressed={selected}
                    className={`rounded-xl border-2 px-4 py-4 text-sm font-medium transition-all ${
                      selected
                        ? "border-al-primary bg-al-primary/5 text-al-primary"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {opt === "NEW" ? "New" : "Used"}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Communication preferences ──────────────────────────────── */}
          <section data-testid="onboarding-communication-prefs">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Communication preferences</h2>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Email notifications</p>
                <p className="text-xs text-slate-500">
                  Auction alerts, deal updates, and important account messages.
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="onboarding-email-notifications"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                disabled={submitting}
                className="h-5 w-5 accent-al-primary"
              />
            </label>
          </section>

          {/* ── Phone number — only when missing ───────────────────────── */}
          {!phoneAlreadySet && (
            <section data-testid="onboarding-phone-section">
              <h2 className="text-base font-semibold text-slate-900 mb-4">Phone number</h2>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(555) 555-5555"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={submitting}
                data-testid="onboarding-phone"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-al-primary focus:ring-2 focus:ring-al-primary/20"
                required
              />
              {phone.trim().length > 0 && (
                <label
                  className="flex items-start gap-2 cursor-pointer select-none mt-3"
                  data-testid="onboarding-sms-consent-label"
                >
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                    data-testid="onboarding-sms-consent-checkbox"
                    className="h-4 w-4 mt-0.5 rounded border-slate-300 text-al-primary focus:ring-al-primary/30"
                  />
                  <span className="text-xs text-slate-500 leading-relaxed">
                    I agree to receive SMS messages from AutoLenis regarding auction
                    alerts, dealer offers, appointment reminders, and service-related
                    communications. Message frequency varies. Message and data rates
                    may apply. Reply STOP to opt out, HELP for assistance. Consent is
                    not a condition of purchase. View our{" "}
                    <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-al-primary hover:underline">Privacy Policy</a>
                    {" "}and{" "}
                    <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-al-primary hover:underline">Terms of Service</a>.
                  </span>
                </label>
              )}
            </section>
          )}

          {error && (
            <div
              data-testid="onboarding-error"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            data-testid="onboarding-finish-btn"
            disabled={!canSubmit}
            className="w-full"
          >
            {submitting ? "Saving…" : "Continue to Pre-Qualification"} <ArrowRight size={15} />
          </Button>
        </form>
      </div>
    </div>
  );
}

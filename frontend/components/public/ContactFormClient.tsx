"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";

const SUBJECT_OPTIONS = [
  "Buyer support",
  "Dealer inquiry",
  "Affiliate question",
  "Partnership",
  "Press & media",
  "Other",
];

export default function ContactFormClient() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [smsConsent, setSmsConsent] = useState(false);

  useEffect(() => {
    if (form.phone.trim().length === 0) setSmsConsent(false);
  }, [form.phone]);

  const phoneProvided = form.phone.trim().length > 0;
  const canSubmit = !loading && (!phoneProvided || smsConsent);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    if (form.phone.trim().length > 0 && !smsConsent) {
      setError("Please agree to receive SMS communications or remove your phone number to continue.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          subject: form.subject,
          message: form.message,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Something went wrong sending your message. Please try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-12" data-testid="contact-success">
        <div className="w-16 h-16 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 size={28} className="text-[#059669]" />
        </div>
        <h3 className="font-bold text-[#111827] text-lg mb-2">Message Sent</h3>
        <p className="text-[#4B5563] text-sm">We&apos;ll be in touch within 2 business days.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} data-testid="contact-form" className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="contact-name" className="text-sm font-medium text-[#374151]">
            Full Name
          </Label>
          <Input
            id="contact-name"
            data-testid="contact-name-input"
            placeholder="Jane Smith"
            className="mt-1.5"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <Label htmlFor="contact-email" className="text-sm font-medium text-[#374151]">
            Email
          </Label>
          <Input
            id="contact-email"
            type="email"
            data-testid="contact-email-input"
            placeholder="jane@example.com"
            className="mt-1.5"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="contact-phone" className="block text-sm font-medium text-slate-700 mb-1.5">
          Phone Number <span className="text-slate-400 font-normal text-xs">(optional)</span>
        </Label>
        <input
          id="contact-phone"
          name="phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="(555) 000-0000"
          autoComplete="tel"
          className="w-full px-3.5 py-2.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl text-sm focus:outline-none focus:border-[#0B5FD1]/60 focus:ring-2 focus:ring-[#0B5FD1]/10 transition-colors"
          data-testid="contact-phone"
        />
      </div>

      <div>
        <Label htmlFor="contact-subject" className="text-sm font-medium text-[#374151]">
          Inquiry Type
        </Label>
        <Select
          id="contact-subject"
          data-testid="contact-subject-select"
          className="mt-1.5"
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          required
        >
          <option value="">Select inquiry type</option>
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="contact-message" className="text-sm font-medium text-[#374151]">
          Message
        </Label>
        <Textarea
          id="contact-message"
          data-testid="contact-message-input"
          placeholder="How can we help you? Please include any relevant details."
          className="mt-1.5 min-h-[140px]"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          required
        />
      </div>

      {form.phone.trim().length > 0 && (
        <label
          className="flex items-start gap-2 cursor-pointer select-none"
          data-testid="contact-sms-consent-label"
        >
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
            data-testid="contact-sms-consent-checkbox"
            className="h-4 w-4 mt-0.5 rounded border-[#CBD5E1] text-[#0B5FD1] focus:ring-[#0B5FD1]/30"
          />
          <span className="text-xs text-[#64748B] leading-relaxed">
            I agree to receive SMS messages from AutoLenis regarding my inquiry,
            account notifications, and service-related communications. Message
            frequency varies. Message and data rates may apply. Reply STOP to opt
            out, HELP for assistance. Consent is not a condition of purchase.
            View our{" "}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Privacy Policy</a>
            {" "}and{" "}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[#0B5FD1] hover:underline">Terms of Service</a>.
          </span>
        </label>
      )}

      {error && (
        <p
          role="alert"
          data-testid="contact-error"
          className="text-sm text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-3"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        data-testid="contact-submit-btn"
        disabled={!canSubmit}
      >
        {loading ? "Sending…" : "Send Message"}
      </Button>

      <p className="text-center text-xs text-[#94A3B8]">
        We respond to all inquiries within 2 business days.
      </p>
    </form>
  );
}

"use client";

import { useState } from "react";
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
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/public/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        subject: form.subject,
        message: form.message,
      }),
    });
    setLoading(false);
    if (res.ok) setSubmitted(true);
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

      <Button
        type="submit"
        className="w-full"
        data-testid="contact-submit-btn"
        disabled={loading}
      >
        {loading ? "Sending…" : "Send Message"}
      </Button>

      <p className="text-center text-xs text-[#94A3B8]">
        We respond to all inquiries within 2 business days.
      </p>
    </form>
  );
}

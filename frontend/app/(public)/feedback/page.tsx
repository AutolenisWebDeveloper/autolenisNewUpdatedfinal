"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";

const CATEGORIES = ["General feedback", "Bug report", "Feature request", "Billing issue", "Dealer concern", "Other"];

export default function FeedbackPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", category: "", message: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, category: form.category, message: form.message }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError("We couldn't send your feedback. Please try again in a moment.");
      }
    } catch {
      // Network/transport failure — never leave the button stuck on "Sending…".
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6" data-testid="feedback-success">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Thank you for your feedback</h2>
          <p className="text-slate-500 text-sm">We read every submission. If you left contact details, our team will follow up within 2 business days.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="py-20 md:py-28 bg-white" data-testid="feedback-page">
      <div className="mx-auto max-w-xl px-6">
        <div className="text-center mb-10">
          <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-3">We&apos;re Listening</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-3">Share your feedback</h1>
          <p className="text-slate-500 text-sm">Help us make AutoLenis better. Every message is read by our team.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" data-testid="feedback-form">
          <div>
            <Label htmlFor="feedback-name">Your name (optional)</Label>
            <Input id="feedback-name" data-testid="feedback-name-input" placeholder="Jane Smith" className="mt-1.5"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="feedback-email">Email address (optional)</Label>
            <Input id="feedback-email" type="email" data-testid="feedback-email-input" placeholder="jane@example.com" className="mt-1.5"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="feedback-category">Category</Label>
            <Select id="feedback-category" data-testid="feedback-category-select" className="mt-1.5"
              value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
              <option value="">Select a category</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea id="feedback-message" data-testid="feedback-message-input" placeholder="Tell us what's on your mind…" className="mt-1.5 min-h-[130px]"
              value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
          </div>
          {error && (
            <p role="alert" data-testid="feedback-error" className="text-sm text-al-danger bg-al-danger-subtle border border-al-danger/20 rounded-lg px-4 py-3">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" data-testid="feedback-submit-btn" disabled={loading}>
            {loading ? "Sending…" : "Send Feedback"}
          </Button>
        </form>
      </div>
    </section>
  );
}

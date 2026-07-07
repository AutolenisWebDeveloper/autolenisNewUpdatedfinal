"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function TestimonialPromptClient({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(5);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/buyer/testimonials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim(), rating, dealId }),
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
    } else {
      setError("Something went wrong. Please try again.");
    }
  }

  if (done) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center" data-testid="testimonial-prompt-done">
        <p className="font-semibold text-slate-800 text-sm mb-1">Thank you!</p>
        <p className="text-xs text-slate-500">Your review has been submitted.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5" data-testid="testimonial-prompt">
      <p className="font-semibold text-slate-800 text-sm mb-2">Share your experience</p>
      <p className="text-xs text-slate-500 mb-3">Your story helps other buyers.</p>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-al-primary font-semibold hover:underline"
          data-testid="leave-review-link"
        >
          Leave a review →
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3" data-testid="testimonial-form">
          <div className="flex gap-1" data-testid="rating-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                data-testid={`rating-star-${n}`}
                className={`text-lg ${n <= rating ? "text-amber-400" : "text-slate-200"}`}
              >
                ★
              </button>
            ))}
          </div>
          <Textarea
            placeholder="What did you like about the AutoLenis experience?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[80px]"
            data-testid="testimonial-body"
            required
          />
          {error && <p className="text-xs text-red-600" data-testid="testimonial-error">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading || !body.trim()} data-testid="testimonial-submit">
              {loading ? "Submitting…" : "Submit Review"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid="testimonial-cancel">
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

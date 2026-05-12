"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, ExternalLink, Loader2, MessageCircle, XCircle } from "lucide-react";

export type ReviewVehicle = {
  vehicleUrl: string;
  stockNumber?: string;
  vin?: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage?: number;
  color?: string;
  interiorColor?: string;
  condition: string;
  offerPriceCents: number;
  tradeInAccepted: boolean;
  financingAvailable: boolean;
  warrantyIncluded: boolean;
  warrantyDetails?: string;
  windowStickerUrl?: string;
  carfaxUrl?: string;
  photos?: string[];
  availability: string;
};

export type ReviewItem = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  dealershipName: string;
  vehicle: ReviewVehicle;
};

export type ReviewData = {
  reviewToken: string;
  buyerName: string;
  buyerEmail: string;
  adminMessage: string | null;
  items: ReviewItem[];
};

export default function BuyerOfferReviewClient({ review, isExpired }: { review: ReviewData; isExpired: boolean }) {
  const [items, setItems] = useState<ReviewItem[]>(review.items);
  const [responding, setResponding] = useState<string | null>(null);
  const [showQuestion, setShowQuestion] = useState<Record<string, boolean>>({});
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [questionSent, setQuestionSent] = useState<Record<string, boolean>>({});
  const [questionSending, setQuestionSending] = useState<string | null>(null);

  if (isExpired) {
    return (
      <main className="min-h-screen bg-[#F8F9FB] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Clock size={26} className="text-amber-600" />
          </div>
          <h2 className="font-bold text-[#111827] text-xl mb-2">This Review Link Has Expired</h2>
          <p className="text-[#4B5563] text-sm">
            This vehicle offer review link is no longer active. Please contact AutoLenis if you believe this is an error.
          </p>
          <a href="mailto:support@autolenis.com" className="inline-block mt-6 text-[#0B5FD1] text-sm font-medium hover:underline">
            Email Support →
          </a>
        </div>
      </main>
    );
  }

  async function handleRespond(itemId: string, status: "ACCEPTED" | "DECLINED") {
    setResponding(itemId);
    try {
      const res = await fetch(`/api/public/buyer-offer-review/${review.reviewToken}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status }),
      });
      if (res.ok) {
        setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status } : i)));
      }
    } catch {
      // Silent fail — UI stays in Pending state and user can retry.
    } finally {
      setResponding(null);
    }
  }

  async function handleSendQuestion(itemId: string) {
    const question = questions[itemId];
    if (!question?.trim()) return;
    setQuestionSending(itemId);
    try {
      const res = await fetch(`/api/public/buyer-offer-review/${review.reviewToken}/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, question }),
      });
      if (res.ok) {
        setQuestionSent((prev) => ({ ...prev, [itemId]: true }));
        setShowQuestion((prev) => ({ ...prev, [itemId]: false }));
      }
    } finally {
      setQuestionSending(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FB]" data-testid="buyer-offer-review-page">
      <header className="bg-white border-b border-[#E5E7EB] px-4 py-4 text-center">
        <span className="text-base font-bold text-[#0B5FD1] tracking-tight">AutoLenis</span>
      </header>

      <section className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Hi {review.buyerName},</h1>
        <p className="text-[#4B5563] mb-2">
          We found <strong>{items.length}</strong> vehicle offer{items.length !== 1 ? "s" : ""} for you to review.
        </p>
        {review.adminMessage && (
          <div className="bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-xl p-4 mt-4">
            <p className="text-sm text-[#0B5FD1] font-medium mb-1">Message from AutoLenis:</p>
            <p className="text-sm text-slate-700 whitespace-pre-line">{review.adminMessage}</p>
          </div>
        )}
      </section>

      <section className="max-w-2xl mx-auto px-4 pb-12 space-y-5">
        {items.map((item) => {
          const v = item.vehicle;
          const isResponding = responding === item.id;
          return (
            <div key={item.id} className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-6 space-y-4" data-testid={`offer-item-${item.id}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-400 mb-1 font-semibold">From Dealership</p>
                  <p className="font-bold text-[#111827] text-lg">{item.dealershipName}</p>
                </div>
                {item.status === "ACCEPTED" && <Badge className="bg-green-100 text-green-700 border-green-200">✓ Accepted</Badge>}
                {item.status === "DECLINED" && <Badge className="bg-red-100 text-red-700 border-red-200">✗ Declined</Badge>}
                {item.status === "PENDING" && <Badge variant="outline">Pending Review</Badge>}
              </div>

              <div>
                <p className="text-xl font-bold text-[#111827]">
                  {v.year} {v.make} {v.model}
                  {v.trim && <span className="text-slate-400 font-normal"> {v.trim}</span>}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="outline">{v.condition}</Badge>
                  {v.mileage && <Badge variant="outline">{v.mileage.toLocaleString()} mi</Badge>}
                  {v.color && <Badge variant="outline">{v.color}</Badge>}
                  {v.interiorColor && <Badge variant="outline">Interior: {v.interiorColor}</Badge>}
                </div>
              </div>

              {v.photos && v.photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1" data-testid={`photos-${item.id}`}>
                  {v.photos.map((url: string, pi: number) => (
                    <img
                      key={pi}
                      src={url}
                      alt={`Vehicle photo ${pi + 1}`}
                      className="h-24 w-32 object-cover rounded-lg shrink-0 border border-slate-100"
                    />
                  ))}
                </div>
              )}

              <a
                href={v.vehicleUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`view-vehicle-${item.id}`}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#0B5FD1] text-white font-semibold text-sm py-3 hover:bg-[#0944a8] transition-colors"
              >
                <ExternalLink size={15} />
                View This Vehicle →
              </a>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Out-the-Door Price</p>
                  <p className="text-2xl font-bold text-[#0B5FD1] font-mono">
                    ${(v.offerPriceCents / 100).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Availability</p>
                  <p className="text-sm font-semibold text-slate-700">{v.availability}</p>
                </div>
              </div>

              {(v.vin || v.stockNumber || v.windowStickerUrl || v.carfaxUrl) && (
                <div className="grid grid-cols-2 gap-3 text-sm border-t border-slate-100 pt-3">
                  {v.vin && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">VIN</p>
                      <p className="font-mono text-xs text-slate-700">{v.vin}</p>
                    </div>
                  )}
                  {v.stockNumber && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Stock #</p>
                      <p className="font-medium text-xs text-slate-700">{v.stockNumber}</p>
                    </div>
                  )}
                  {v.carfaxUrl && (
                    <a href={v.carfaxUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0B5FD1] hover:underline flex items-center gap-1">
                      <ExternalLink size={11} /> CARFAX Report
                    </a>
                  )}
                  {v.windowStickerUrl && (
                    <a href={v.windowStickerUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0B5FD1] hover:underline flex items-center gap-1">
                      <ExternalLink size={11} /> Window Sticker
                    </a>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className={`rounded-lg py-2 ${v.tradeInAccepted ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"}`}>
                  {v.tradeInAccepted ? "✓" : "✗"} Trade-In
                </div>
                <div className={`rounded-lg py-2 ${v.financingAvailable ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"}`}>
                  {v.financingAvailable ? "✓" : "✗"} Financing
                </div>
                <div className={`rounded-lg py-2 ${v.warrantyIncluded ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"}`}>
                  {v.warrantyIncluded ? "✓" : "✗"} Warranty
                </div>
              </div>
              {v.warrantyIncluded && v.warrantyDetails && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                  Warranty: {v.warrantyDetails}
                </p>
              )}

              {item.status === "PENDING" ? (
                <div>
                  <div className="flex gap-3 pt-2">
                    <Button
                      className="flex-1 h-11"
                      onClick={() => handleRespond(item.id, "ACCEPTED")}
                      disabled={isResponding}
                      data-testid={`accept-offer-${item.id}`}
                    >
                      {isResponding ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      Accept This Offer
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-11"
                      onClick={() => handleRespond(item.id, "DECLINED")}
                      disabled={isResponding}
                      data-testid={`decline-offer-${item.id}`}
                    >
                      <XCircle size={16} /> Decline
                    </Button>
                  </div>

                  {questionSent[item.id] ? (
                    <p className="text-xs text-green-600 mt-2 text-center">✓ Your question was sent — we&rsquo;ll get back to you shortly.</p>
                  ) : !showQuestion[item.id] ? (
                    <button
                      type="button"
                      onClick={() => setShowQuestion((prev) => ({ ...prev, [item.id]: true }))}
                      className="w-full text-xs text-slate-400 hover:text-[#0B5FD1] mt-2 py-1 hover:underline inline-flex items-center justify-center gap-1"
                      data-testid={`ask-question-${item.id}`}
                    >
                      <MessageCircle size={11} /> Have a question about this offer?
                    </button>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={questions[item.id] ?? ""}
                        onChange={(e) => setQuestions((prev) => ({ ...prev, [item.id]: e.target.value.slice(0, 500) }))}
                        placeholder="Ask about availability, delivery, trade-in value, financing terms, etc."
                        rows={2}
                        className="text-sm"
                        data-testid={`question-input-${item.id}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleSendQuestion(item.id)}
                          variant="outline"
                          className="flex-1"
                          disabled={!questions[item.id]?.trim() || questionSending === item.id}
                          data-testid={`send-question-${item.id}`}
                        >
                          {questionSending === item.id ? <Loader2 size={14} className="animate-spin" /> : "Send Question"}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setShowQuestion((prev) => ({ ...prev, [item.id]: false }))}
                          className="text-xs text-slate-400 px-3"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={`rounded-xl p-4 text-center ${item.status === "ACCEPTED" ? "bg-green-50 border border-green-200" : "bg-slate-50 border border-slate-200"}`}>
                  <p className={`text-sm font-medium ${item.status === "ACCEPTED" ? "text-green-700" : "text-slate-600"}`}>
                    {item.status === "ACCEPTED"
                      ? "✓ You accepted this offer. Our team will follow up to complete the deal."
                      : "You declined this offer."}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Account creation prompt */}
      <section className="max-w-2xl mx-auto px-4 pb-8">
        <div
          className="bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-2xl p-6 text-center"
          data-testid="buyer-review-account-prompt"
        >
          <h3 className="font-bold text-[#111827] mb-2">Track This Offer From Your Dashboard</h3>
          <p className="text-sm text-[#4B5563] mb-4">
            Create a free AutoLenis account to track this offer, view updates, and manage your vehicle search — all in one place.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a
              href="/auth/signup"
              data-testid="buyer-review-create-account-btn"
              className="inline-flex items-center gap-2 bg-[#0B5FD1] text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#0944a8] transition-colors"
            >
              Create Free Account →
            </a>
            <a
              href="/auth/signin"
              data-testid="buyer-review-signin-btn"
              className="inline-flex items-center gap-2 border border-[#0B5FD1] text-[#0B5FD1] rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#0B5FD1]/5 transition-colors"
            >
              Sign In
            </a>
          </div>
          <p className="text-xs text-slate-400 mt-3">Free to join. No credit card required.</p>
        </div>
      </section>

      <footer className="border-t border-[#E5E7EB] mt-12 py-6 text-center">
        <p className="text-xs text-slate-400">
          Questions? Email us at{" "}
          <a href="mailto:support@autolenis.com" className="text-[#0B5FD1]">support@autolenis.com</a>
        </p>
        <p className="text-xs text-slate-400 mt-1">
          This review link was sent to {review.buyerEmail}.
        </p>
      </footer>
    </main>
  );
}

// Feature 12 — Auction Live View with Real-Time Updates
// Countdown timer, offer count, engagement signals
// Uses SWR for polling every 30 s (degrades gracefully if SWR unavailable)

"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Zap } from "lucide-react";
import { deriveAuctionEngagement } from "@/lib/services/auction/auction-engagement";

interface LiveAuctionViewProps {
  auctionId: string;
  endsAt: string;
  initialOfferCount?: number;
  initialDealersInvited?: number;
}

interface LiveStatusData {
  offerCount: number;
  dealersInvited?: number;
  engagementLevel: string;
  socialProof?: string;
  status?: string;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Auction closed";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json() as Promise<{ success: boolean; data: LiveStatusData }>)
    .then((d) => {
      if (!d.success) throw new Error("live-status error");
      return d.data;
    });

export default function LiveAuctionView({
  auctionId,
  endsAt,
  initialOfferCount = 0,
  initialDealersInvited = 0,
}: LiveAuctionViewProps) {
  const [remaining, setRemaining] = useState(new Date(endsAt).getTime() - Date.now());

  // Truthful fallback (before the first poll returns): derive the same engagement
  // signal the API produces from the initial counts, so we never briefly show an
  // optimistic "Active" when no dealer has actually submitted an offer.
  const fallbackEngagement = deriveAuctionEngagement({
    status: "ACTIVE",
    dealersInvited: initialDealersInvited,
    offerCount: initialOfferCount,
  });

  // Feature 12 — SWR polling every 30 seconds against the live-status API
  const { data } = useSWR<LiveStatusData>(
    `/api/buyer/auctions/${auctionId}/live-status`,
    fetcher,
    {
      refreshInterval: 30000,
      fallbackData: {
        offerCount: initialOfferCount,
        dealersInvited: initialDealersInvited,
        engagementLevel: fallbackEngagement.engagementLevel,
        socialProof: fallbackEngagement.socialProof,
      },
      revalidateOnFocus: false,
    },
  );

  const offerCount = data?.offerCount ?? initialOfferCount;
  const dealersInvited = data?.dealersInvited ?? initialDealersInvited;
  const engagement = data?.engagementLevel ?? fallbackEngagement.engagementLevel;
  const socialProof = data?.socialProof ?? fallbackEngagement.socialProof;

  // Countdown timer — client-side from endsAt timestamp
  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(new Date(endsAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  const isActive = remaining > 0;

  return (
    <div className="bg-al-primary rounded-2xl p-6 text-white" data-testid="auction-status-panel">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${isActive ? "bg-green-400 animate-pulse" : "bg-slate-400"}`} />
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          {isActive ? "Your Auction is Live" : "Auction Closed"}
        </span>
      </div>

      {/* Countdown — runs client-side from endsAt */}
      <div className="text-center mb-6" data-testid="auction-countdown">
        <p className="text-4xl sm:text-5xl font-bold font-mono tracking-tight">{formatCountdown(remaining)}</p>
        <p className="text-sm text-white/60 mt-1">{isActive ? "remaining" : ""}</p>
      </div>

      {/* Group 7 (7B) — dealer invitation transparency */}
      {dealersInvited > 0 && (
        <p className="text-center text-sm text-white/80 mb-4" data-testid="auction-dealers-invited">
          <span className="font-semibold text-white">{dealersInvited}</span>{" "}
          dealer{dealersInvited !== 1 ? "s" : ""} invited to compete
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white/10 rounded-xl p-4 text-center" data-testid="auction-offer-count">
          <p className="text-2xl font-bold">{offerCount}</p>
          <p className="text-xs text-white/60 mt-0.5">Offers received so far</p>
        </div>
        <div className="bg-white/10 rounded-xl p-4 text-center" data-testid="auction-engagement">
          <div className="flex items-center justify-center gap-1.5 mb-0.5">
            <Zap size={14} className="text-[#50D14E]" />
            <p className="text-sm font-bold">{engagement}</p>
          </div>
          <p className="text-xs text-white/60">Dealer interest</p>
        </div>
      </div>

      {/* Social proof signal */}
      {socialProof && (
        <div className="bg-white/10 rounded-xl px-4 py-2 mb-4 text-center" data-testid="auction-social-proof">
          <p className="text-xs text-white/80 font-medium">{socialProof}</p>
        </div>
      )}

      {/* What happens next */}
      <div className="bg-white/10 rounded-xl p-4 text-sm text-white/75">
        <p className="font-semibold text-white mb-1.5">What happens next</p>
        {offerCount > 0 ? (
          <p>When your auction closes, you&apos;ll choose from ranked offers — Best Cash, Best Monthly, and Best Overall Value.</p>
        ) : dealersInvited > 0 ? (
          <p>Invited dealers have until the deadline to submit their best offer. Offer count updates every 30 seconds.</p>
        ) : (
          <p>We&apos;re finding qualified dealers for your request. This updates every 30 seconds.</p>
        )}
      </div>

      {/* Polling indicator */}
      <p className="text-[10px] text-white/40 text-right mt-3">Updates every 30 s</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Zap, CheckCircle2, Users } from "lucide-react";

interface SocialProofEvent {
  type: "deal_completed" | "auction_started" | "buyer_joined";
  label: string;
  location?: string;
  timeAgoMinutes: number;
}

function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function eventIcon(type: SocialProofEvent["type"]) {
  if (type === "deal_completed") return <CheckCircle2 size={13} className="text-[#50D14E] shrink-0" aria-hidden />;
  if (type === "auction_started") return <Zap size={13} className="text-[#53C8E7] shrink-0" aria-hidden />;
  return <Users size={13} className="text-[#A78BCC] shrink-0" aria-hidden />;
}

export default function SocialProofBar() {
  const [events, setEvents] = useState<SocialProofEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/public/social-proof")
      .then((r) => r.json())
      .then((d: { success: boolean; data: SocialProofEvent[] }) => {
        if (d.success && d.data.length > 0) setEvents(d.data);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Hide bar if no activity or still loading
  if (!loaded || events.length === 0) return null;

  return (
    <div
      className="w-full bg-[#111827] border-b border-[#172554] overflow-hidden"
      data-testid="social-proof-bar"
      aria-label="Recent platform activity"
    >
      <div className="mx-auto max-w-7xl px-6 py-2.5">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#A78BCC] shrink-0 hidden sm:block">
            Live Activity
          </span>
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
            {events.map((ev, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 whitespace-nowrap text-xs text-white/80 shrink-0"
                data-testid={`social-proof-event-${i}`}
              >
                {eventIcon(ev.type)}
                <span>{ev.label}</span>
                {ev.location && (
                  <span className="text-white/50">· {ev.location}</span>
                )}
                <span className="text-white/40">{formatTimeAgo(ev.timeAgoMinutes)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

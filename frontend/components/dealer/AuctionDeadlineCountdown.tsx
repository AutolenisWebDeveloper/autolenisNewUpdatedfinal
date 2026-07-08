"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface Props {
  endsAtIso: string;
  serverNowIso: string;
}

// Server-clock-driven countdown. Computes the server/client clock skew once
// on mount so the ticking timer is always referenced to the auction server's
// notion of "now", not the user's possibly-skewed local clock.
export default function AuctionDeadlineCountdown({ endsAtIso, serverNowIso }: Props) {
  const endsAt = new Date(endsAtIso).getTime();
  const serverNow = new Date(serverNowIso).getTime();
  const [skewMs] = useState(() => serverNow - Date.now());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Effective "now" tracks server time using the captured skew.
  const effectiveNow = Date.now() + skewMs;
  const ms = endsAt - effectiveNow;
  // tick is read to force a render every second
  void tick;

  if (ms <= 0) {
    return (
      <div
        className="bg-slate-100 border border-slate-200 rounded-2xl p-4 mb-6 flex items-center gap-3"
        data-testid="auction-deadline-expired"
      >
        <Clock size={18} className="text-slate-400" />
        <div>
          <p className="font-semibold text-slate-700 text-sm">Auction closed</p>
          <p className="text-xs text-slate-500">This auction is no longer accepting offers.</p>
        </div>
      </div>
    );
  }

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const display = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
    ? `${hours}h ${minutes}m ${seconds}s`
    : `${minutes}m ${seconds}s`;

  const isUrgent = ms <= 6 * 3600_000;

  return (
    <div
      className={
        isUrgent
          ? "bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 flex items-center gap-3"
          : "bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-center gap-3"
      }
      data-testid="auction-deadline-alert"
    >
      <Clock size={18} className={isUrgent ? "text-red-500" : "text-amber-500"} />
      <div>
        <p className={isUrgent ? "font-semibold text-red-800 text-sm" : "font-semibold text-amber-800 text-sm"}>
          <span className="font-mono tabular-nums">{display}</span> remaining
        </p>
        <p className={isUrgent ? "text-xs text-red-700" : "text-xs text-amber-700"}>
          Submit your offer before the auction closes
        </p>
      </div>
    </div>
  );
}

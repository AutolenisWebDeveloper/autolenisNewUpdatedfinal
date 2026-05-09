"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Polls a cheap authenticated endpoint and shows a session-expiry modal when the
// server returns 401. Mounted globally inside /buyer/layout.tsx so any expired
// session — whether discovered via the periodic ping or via a fetch interceptor —
// shows the same modal across the buyer portal.
export default function SessionExpiryWatcher() {
  const [expired, setExpired] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    async function ping() {
      try {
        const res = await fetch("/api/buyer/me", { cache: "no-store" });
        if (!cancelled && res.status === 401) setExpired(true);
      } catch {
        // network error — do not flip the modal; only flip on a real 401
      }
    }

    ping(); // initial check
    const interval = setInterval(ping, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!expired) return null;

  const redirect = encodeURIComponent(pathname || "/buyer/dashboard");

  return (
    <div
      data-testid="session-expiry-modal"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-[90%] p-7 text-center">
        <h2
          data-testid="session-expiry-title"
          className="text-lg font-semibold text-slate-900 mb-2"
        >
          Your session has expired
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          For your security, please sign in again to continue.
        </p>
        <Button
          data-testid="session-expiry-signin-btn"
          className="w-full"
          onClick={() => router.push(`/auth/signin?redirect=${redirect}`)}
        >
          Sign in
        </Button>
      </div>
    </div>
  );
}

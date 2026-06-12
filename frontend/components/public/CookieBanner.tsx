"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  acceptAll,
  rejectNonEssential,
  hasDecided,
} from "@/lib/cookie-consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if user has not decided yet
    if (!hasDecided()) {
      // Small delay so it does not flash on hydration
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    acceptAll();
    setVisible(false);
    // Reload to activate analytics scripts
    window.location.reload();
  };

  const handleReject = () => {
    rejectNonEssential();
    setVisible(false);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50
        bg-white border-t border-slate-200 shadow-lg
        animate-in slide-in-from-bottom duration-300"
      role="dialog"
      aria-label="Cookie consent"
      aria-modal="false"
      data-testid="cookie-banner"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center
          justify-between gap-4"
        >
          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-700 leading-relaxed">
              We use cookies and other tracking technologies to improve your
              experience, analyze site traffic, and assist with our marketing
              efforts. You can choose to accept all cookies or only essential
              ones. Learn more in our{" "}
              <Link
                href="/legal/cookie-policy"
                className="text-[#0B5FD1] underline hover:text-[#0a54bc]
                  font-medium"
              >
                Cookie Policy
              </Link>
              {" "}and{" "}
              <Link
                href="/legal/privacy"
                className="text-[#0B5FD1] underline hover:text-[#0a54bc]
                  font-medium"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleReject}
              data-testid="cookie-reject"
              className="px-4 py-2 text-sm font-semibold text-slate-700
                border border-slate-300 rounded-lg hover:bg-slate-50
                transition-colors whitespace-nowrap"
            >
              Reject Non-Essential
            </button>
            <button
              onClick={handleAccept}
              data-testid="cookie-accept"
              className="px-4 py-2 text-sm font-semibold text-white
                bg-[#0B5FD1] rounded-lg hover:bg-[#0a54bc]
                transition-colors whitespace-nowrap"
            >
              Accept All
            </button>
            {/* Close without deciding — banner reappears next visit */}
            <button
              onClick={() => setVisible(false)}
              aria-label="Close banner"
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

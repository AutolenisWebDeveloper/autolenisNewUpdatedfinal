"use client";

// components/referral/ReferralCapture.tsx
// Group 8 (8A) — fires once per browser session to record an affiliate referral
// click. proxy.ts already persists ?ref= into the `affiliate_ref` cookie (30-day
// attribution); this component adds the *click ledger* on top of that so
// affiliates can see real click → conversion funnels in their dashboard.
//
// Mounted sitewide from the root layout (app/layout.tsx). Renders nothing.
// Deliberately dependency-free and self-guarding: a tracking failure must never
// affect the page the visitor actually came to see.

import { useEffect } from "react";

const SESSION_FLAG = "al_ref_tracked";

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export default function ReferralCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      // URL ?ref= wins; fall back to the attribution cookie proxy.ts set.
      const referralCode = (params.get("ref") || readCookie("affiliate_ref") || "").trim();
      if (!referralCode || referralCode.length < 4) return;

      // One click per browser session per code — avoids re-counting every
      // client navigation. Keyed by code so a different link still records.
      const flagKey = `${SESSION_FLAG}:${referralCode}`;
      if (sessionStorage.getItem(flagKey)) return;
      sessionStorage.setItem(flagKey, "1");

      const payload = {
        referralCode,
        landingPath: window.location.pathname,
        referer: document.referrer || null,
        utmSource: params.get("utm_source"),
        utmMedium: params.get("utm_medium"),
        utmCampaign: params.get("utm_campaign"),
      };

      void fetch("/api/public/referral/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Allow a retry on the next session if this fire failed.
        try {
          sessionStorage.removeItem(flagKey);
        } catch {
          /* sessionStorage unavailable — ignore */
        }
      });
    } catch {
      /* never let referral capture break the page */
    }
  }, []);

  return null;
}

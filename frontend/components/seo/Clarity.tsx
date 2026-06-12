"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { getConsent, type ConsentState } from "@/lib/cookie-consent";

const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID;

export default function Clarity() {
  const [analyticsAllowed, setAnalyticsAllowed] = useState(false);

  useEffect(() => {
    const consent = getConsent();
    setAnalyticsAllowed(consent.analytics);

    const handleConsentUpdate = (e: Event) => {
      const detail = (e as CustomEvent<ConsentState>).detail;
      setAnalyticsAllowed(detail.analytics);
    };
    window.addEventListener("consentUpdated", handleConsentUpdate);
    return () =>
      window.removeEventListener("consentUpdated", handleConsentUpdate);
  }, []);

  if (process.env.NODE_ENV !== "production" || !CLARITY_ID) return null;
  if (!analyticsAllowed) return null;

  return (
    <Script id="ms-clarity" strategy="afterInteractive">{`
      (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window,document,"clarity","script","${CLARITY_ID}");
    `}</Script>
  );
}

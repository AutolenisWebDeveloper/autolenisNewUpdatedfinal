"use client";

import { useEffect, useRef } from "react";
import { trackContentConversion } from "@/lib/analytics/events";
import { readContentAttribution } from "@/lib/analytics/attribution";

interface ContentConversionTrackerProps {
  conversionType: "deposit_paid" | "deal_created";
  valueCents?: number;
}

/**
 * Phase C-Attribution — fires the macro-conversion `content_conversion` GA4
 * event once on mount, enriched with the content dimensions (cluster / city /
 * state / metro) from the visitor's last-touch attribution cookie. Mounted on
 * conversion surfaces (e.g. the deposit success page) so converted buyers who
 * arrived from a buying-guide article are credited to it in GA4.
 */
export default function ContentConversionTracker({
  conversionType,
  valueCents,
}: ContentConversionTrackerProps) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const attr = readContentAttribution();
    trackContentConversion({
      articleSlug: attr?.slug,
      cluster: attr?.cluster,
      city: attr?.city,
      state: attr?.state,
      metro: attr?.metro,
      conversionType,
      valueCents,
    });
  }, [conversionType, valueCents]);

  return null;
}

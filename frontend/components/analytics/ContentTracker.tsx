"use client";

import { useEffect, useRef } from "react";
import { trackArticleView, trackScrollDepth } from "@/lib/analytics/events";

interface ContentTrackerProps {
  articleSlug: string;
  cluster?: string;
  city?: string;
  state?: string;
}

const DEPTHS: Array<25 | 50 | 75 | 100> = [25, 50, 75, 100];

/**
 * Phase C0 — fires an article_view event on mount and scroll_depth events as
 * the reader passes 25/50/75/100% of the document. Client-only; mounted on
 * every buying-guide page. Each depth fires at most once per page load.
 */
export default function ContentTracker({
  articleSlug,
  cluster,
  city,
  state,
}: ContentTrackerProps) {
  const firedView = useRef(false);
  const firedDepths = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!firedView.current) {
      firedView.current = true;
      trackArticleView({ articleSlug, cluster, city, state });
    }

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      if (scrollable <= 0) return;
      const pct = (window.scrollY / scrollable) * 100;
      for (const depth of DEPTHS) {
        if (pct >= depth && !firedDepths.current.has(depth)) {
          firedDepths.current.add(depth);
          trackScrollDepth({ articleSlug, depth });
        }
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [articleSlug, cluster, city, state]);

  return null;
}

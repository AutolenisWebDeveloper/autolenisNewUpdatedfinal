"use client";

import { useEffect, useRef } from "react";
import { trackArticleView, trackScrollDepth } from "@/lib/analytics/events";
import { captureContentAttribution } from "@/lib/analytics/attribution";

interface ContentTrackerProps {
  articleSlug: string;
  cluster?: string;
  city?: string;
  state?: string;
  metro?: string;
}

const DEPTHS: Array<25 | 50 | 75 | 100> = [25, 50, 75, 100];

/**
 * Phase C0 — fires an article_view event on mount and scroll_depth events as
 * the reader passes 25/50/75/100% of the document. Client-only; mounted on
 * every buying-guide page. Each depth fires at most once per page load.
 *
 * Phase C-Attribution — also drops a first-party last-touch attribution cookie
 * so a lead the reader submits later (anywhere on the site) can be attributed
 * back to this article's cluster / city / state / metro.
 */
export default function ContentTracker({
  articleSlug,
  cluster,
  city,
  state,
  metro,
}: ContentTrackerProps) {
  const firedView = useRef(false);
  const firedDepths = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!firedView.current) {
      firedView.current = true;
      trackArticleView({ articleSlug, cluster, city, state });
      if (cluster && city && state) {
        captureContentAttribution({ slug: articleSlug, cluster, city, state, metro });
      }
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
  }, [articleSlug, cluster, city, state, metro]);

  return null;
}

// Phase C0 — GA4 custom events layer for the content engine.
// All events flow through window.gtag with an SSR-safe null check. Analytics
// must never throw into UX, so every call is wrapped defensively.

type CtaPosition = "above_fold" | "mid_page" | "bottom";
type CalculatorStep = "start" | "complete" | "lead_capture";
type ScrollDepth = 25 | 50 | 75 | 100;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

function emit(event: string, params: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.gtag?.("event", event, params);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...params });
    if (process.env.NODE_ENV !== "production") {
      console.log("[content-analytics]", event, params);
    }
  } catch {
    // Analytics must never throw into UX.
  }
}

export function trackArticleCTA(params: {
  articleSlug: string;
  cluster: string;
  city: string;
  state: string;
  position: CtaPosition;
}): void {
  emit("article_cta_click", {
    article_slug: params.articleSlug,
    cluster: params.cluster,
    city: params.city,
    state: params.state,
    position: params.position,
  });
}

export function trackCalculatorUse(params: {
  calculatorName: string;
  state: string;
  step: CalculatorStep;
}): void {
  emit("calculator_use", {
    calculator_name: params.calculatorName,
    state: params.state,
    step: params.step,
  });
}

export function trackLeadMagnet(params: {
  magnetName: string;
  buyerTimeline: string;
}): void {
  emit("lead_magnet", {
    magnet_name: params.magnetName,
    buyer_timeline: params.buyerTimeline,
  });
}

export function trackScrollDepth(params: {
  articleSlug: string;
  depth: ScrollDepth;
}): void {
  emit("scroll_depth", {
    article_slug: params.articleSlug,
    depth: params.depth,
  });
}

export function trackArticleView(params: {
  articleSlug: string;
  cluster?: string;
  city?: string;
  state?: string;
}): void {
  emit("article_view", {
    article_slug: params.articleSlug,
    ...(params.cluster ? { cluster: params.cluster } : {}),
    ...(params.city ? { city: params.city } : {}),
    ...(params.state ? { state: params.state } : {}),
  });
}

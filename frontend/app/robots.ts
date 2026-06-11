import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const base = SITE_ORIGIN;

  // Private / functional areas blocked for everyone. /lp/* stays disallowed so
  // the paid funnel never competes with the organic /car-buying-service hub.
  const disallow = [
    "/buyer/", "/dealer/", "/affiliate/portal/", "/admin/", "/api/", "/auth/",
    "/lp/", "/thank-you",
  ];

  // AI crawler policy: ALLOW ALL (owner-confirmed). Listed explicitly so the
  // policy is intentional and auditable — these bots get the same access as
  // search crawlers, never less.
  const aiCrawlers = [
    "OAI-SearchBot", "ChatGPT-User", "GPTBot",
    "PerplexityBot", "Perplexity-User",
    "Google-Extended", "ClaudeBot", "Claude-Web", "anthropic-ai",
    "Applebot-Extended", "CCBot",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // Same allow/disallow surface for every AI crawler — explicit allow.
      ...aiCrawlers.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: [
      `${base}/sitemap.xml`,
      `${base}/image-sitemap.xml`,
      // AMIPS tier-segmented sitemap index (Tiers A–D).
      `${base}/sitemap-amips.xml`,
      // Market-intelligence pages (/intelligence/*).
      `${base}/sitemap-intelligence.xml`,
    ],
    host: base,
  };
}

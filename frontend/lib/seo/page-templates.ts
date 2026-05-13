// Canonical SEO architecture per page-intent.
// Use this as the reference for what schema types, content blocks, and CTA
// styles a given page must include based on its search intent.

export const PAGE_TEMPLATES = {

  // INFORMATIONAL — educate, not sell
  // Target: top-of-funnel, low-intent
  informational: {
    schemaTypes: ["WebPage", "Article", "FAQPage"],
    ctaStyle: "soft", // "Learn more", "How it works"
    contentDepth: "comprehensive",
    faqRequired: true,
    citationBlocksRequired: true,
    definitionBlockRequired: true,
    internalLinks: ["related articles", "service pages", "FAQ"],
    metaTitle: "[Topic] — AutoLenis Guide",
    noindex: false,
  },

  // TRANSACTIONAL — drive immediate action
  // Target: bottom-of-funnel, high-intent
  transactional: {
    schemaTypes: ["WebPage", "Service", "Offer"],
    ctaStyle: "strong", // "Start Now", "Get Offers"
    contentDepth: "concise",
    faqRequired: true,
    citationBlocksRequired: true,
    definitionBlockRequired: false,
    internalLinks: ["pricing", "how-it-works", "request-vehicle"],
    metaTitle: "[Action] — AutoLenis",
    noindex: false,
  },

  // LOCAL — city/service area
  // Target: geo-modified high-intent
  local: {
    schemaTypes: ["LocalBusiness", "Service", "FAQPage", "BreadcrumbList"],
    ctaStyle: "local", // "Start in [City]", "Find [City] dealers"
    contentDepth: "medium",
    faqRequired: true,
    citationBlocksRequired: true,
    definitionBlockRequired: false,
    internalLinks: ["nearby cities", "how-it-works", "request-vehicle"],
    metaTitle: "Car Buying Concierge in [City], [State] — AutoLenis",
    noindex: false,
  },

  // COMPARISON — convert fence-sitters
  // Target: commercial investigation intent
  comparison: {
    schemaTypes: ["WebPage", "Table", "FAQPage"],
    ctaStyle: "value", // "Why AutoLenis wins", "See the difference"
    contentDepth: "detailed",
    faqRequired: true,
    citationBlocksRequired: true,
    definitionBlockRequired: false,
    internalLinks: ["pricing", "how-it-works", "testimonials"],
    metaTitle: "AutoLenis vs [Competitor] — Honest Comparison",
    noindex: false,
  },

  // TRUST — reinforce credibility
  // Target: E-E-A-T signals, brand searches
  trust: {
    schemaTypes: ["WebPage", "AboutPage", "Person", "Organization"],
    ctaStyle: "soft",
    contentDepth: "story-driven",
    faqRequired: false,
    citationBlocksRequired: false,
    definitionBlockRequired: false,
    internalLinks: ["testimonials", "how-it-works", "contact"],
    metaTitle: "About AutoLenis — Our Story and Mission",
    noindex: false,
  },

  // CONVERSION — pure CTA pages
  // Target: direct conversion, paid landing
  conversion: {
    schemaTypes: ["WebPage", "Service"],
    ctaStyle: "urgent",
    contentDepth: "minimal",
    faqRequired: true,
    citationBlocksRequired: false,
    definitionBlockRequired: false,
    internalLinks: ["pricing", "faq"],
    noindex: false,
  },

} as const;

export type PageTemplate = keyof typeof PAGE_TEMPLATES;

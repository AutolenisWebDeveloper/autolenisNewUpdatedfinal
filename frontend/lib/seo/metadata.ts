import type { Metadata } from "next";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const OG_IMAGE = `${APP_URL}/og-image.jpg`;
const SITE_NAME = "AutoLenis";
const TWITTER_HANDLE = "@autolenis";

interface PageMetaInput {
  title: string;
  description: string;
  path: string;
  keywords?: readonly string[];
  ogImage?: string;
  noindex?: boolean;
}

export function buildPageMetadata(input: PageMetaInput): Metadata {
  const { title, description, path, keywords, ogImage, noindex } = input;
  const url = `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const image = ogImage ?? OG_IMAGE;

  return {
    title,
    description,
    keywords: keywords ? [...keywords] : undefined,
    alternates: { canonical: url },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER_HANDLE,
      title,
      description,
      images: [image],
    },
  };
}

// Pre-baked metadata definitions for every public page
export const PAGE_METADATA = {
  home: {
    title: "AutoLenis — Where Dealers Compete for You | Car Buying Concierge",
    description:
      "Verified dealers compete for your business in a private 48-hour auction. " +
      "Compare every offer side by side. Choose the best deal. " +
      "AutoLenis is the buyer-first car buying concierge platform.",
    path: "/",
    keywords: [
      "car buying concierge", "reverse auction car buying", "best car deals",
      "no negotiation car buying", "online car auction",
    ],
  },
  inventory: {
    title: "Browse Available Vehicles",
    description:
      "Search thousands of verified vehicles and let dealers compete for your business. Filter by make, model, ZIP code, price, and more.",
    path: "/inventory",
    keywords: ["used cars", "verified dealers", "car inventory search", "buy car online"],
  },
  pricing: {
    title: "Pricing — Free to Start, $499 Premium Concierge",
    description:
      "Start free with a one-time $99 non-refundable Auction Access Fee, or go Premium for the full white-glove experience. No hidden fees.",
    path: "/pricing",
    keywords: ["car concierge price", "AutoLenis pricing", "premium car buying"],
  },
  howItWorks: {
    title: "How AutoLenis Works | The Buyer Advantage Platform",
    description:
      "See how AutoLenis helps buyers get prequalified, compare competing dealer offers, and buy with more confidence and clarity.",
    path: "/how-it-works",
    keywords: [
      "how AutoLenis works",
      "reverse car auction process",
      "car concierge steps",
      "dealer competition car buying",
      "buyer first auto purchase",
    ],
  },
  forBuyers: {
    title: "For Car Buyers — No Negotiation, No Stress",
    description:
      "Let dealers compete for your business in a private 48-hour auction. No haggling, no high-pressure sales. Just your best deal.",
    path: "/for-buyers",
    keywords: ["car buyers concierge", "no haggle car buying", "private car auction"],
  },
  forDealers: {
    title: "Join the Dealer Network — Qualified Buyers, No Cold Traffic",
    description:
      "Connect with serious, pre-qualified buyers. Submit competitive offers in private auctions. Grow your business with AutoLenis.",
    path: "/for-dealers",
    keywords: ["dealer network", "qualified car buyers", "auto dealer leads"],
  },
  forAffiliates: {
    title: "Become an AutoLenis Affiliate — Earn 15% Commission",
    description:
      "Refer car buyers and earn 15% on every completed deal. Three-level commission structure. Join the AutoLenis affiliate network.",
    path: "/for-affiliates",
    keywords: ["car affiliate program", "auto referral commission", "AutoLenis affiliate"],
  },
  refinance: {
    title: "Refinance Your Car Loan — Check Your Eligibility",
    description:
      "See if you qualify for a lower car payment. AutoLenis connects qualified drivers with OpenRoad Lending. No credit pull to check eligibility.",
    path: "/refinance",
    keywords: ["car loan refinance", "auto loan refi", "lower car payment"],
  },
  trust: {
    title: "Trust & Security — How We Protect You",
    description:
      "Contract Shield catches junk fees and unfair terms. Verified dealers only. $99 refund guarantee. See how AutoLenis protects every buyer.",
    path: "/trust",
    keywords: ["car buying protection", "Contract Shield", "verified car dealers"],
  },
  contractShield: {
    title: "Contract Shield™ — Dealer Contract Review",
    description:
      "AutoLenis reviews every dealer contract for junk fees, APR accuracy, and hidden charges before you sign anything.",
    path: "/contract-shield",
    keywords: ["dealer contract review", "junk fee detection", "APR check"],
  },
  faq: {
    title: "Frequently Asked Questions",
    description:
      "Everything you need to know about how AutoLenis works, our pricing, auctions, prequalification, and more.",
    path: "/faq",
    keywords: ["AutoLenis FAQ", "car concierge questions"],
  },
  about: {
    title: "About AutoLenis | Built to Protect Buyers",
    description:
      "Learn how AutoLenis helps buyers gain leverage, compare offers, and purchase vehicles with more confidence, clarity, and control.",
    path: "/about",
    keywords: ["about AutoLenis", "car buying platform", "buyer advantage"],
  },
  contact: {
    title: "Contact Us — We're Here to Help",
    description: "Questions or feedback? Reach the AutoLenis team — we respond within one business day.",
    path: "/contact",
  },
  requestACar: {
    title: "Request a Specific Vehicle",
    description:
      "Can't find the exact vehicle you want? Submit a request and let AutoLenis source competitive dealer offers for your specific make, model, and budget.",
    path: "/request-a-car",
    keywords: ["request a car", "find a specific vehicle", "custom car search", "vehicle sourcing"],
  },
  testimonials: {
    title: "Real Buyer Stories — AutoLenis Reviews",
    description:
      "See what real buyers, dealers, and affiliate partners say about AutoLenis. Genuine stories from people who used the platform to buy smarter.",
    path: "/testimonials",
    keywords: ["AutoLenis reviews", "AutoLenis testimonials", "car buying experience", "buyer stories"],
  },
  compare: {
    title: "AutoLenis vs Traditional Car Buying",
    description:
      "See how AutoLenis compares to traditional dealerships, car listing sites, and other buying approaches. Understand what makes dealer competition different.",
    path: "/compare",
    keywords: [
      "AutoLenis vs dealership",
      "car buying comparison",
      "better way to buy a car",
      "dealer competition vs negotiation",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    description: "Learn how AutoLenis collects, uses, shares, and protects information when you use our platform.",
    path: "/legal/privacy",
    keywords: ["AutoLenis privacy", "data protection", "privacy policy"],
  },
  terms: {
    title: "Terms of Service",
    description: "Review the terms and conditions that govern use of the AutoLenis platform.",
    path: "/legal/terms",
    keywords: ["AutoLenis terms", "terms of service", "user agreement"],
  },
  insurance: {
    title: "Auto Insurance",
    description:
      "Get competitive auto insurance quotes as part of your AutoLenis deal, or upload your own coverage to proceed.",
    path: "/insurance",
    keywords: ["auto insurance", "car insurance quote", "AutoLenis insurance"],
  },
  dealerApplication: {
    title: "Dealer Application",
    description:
      "Apply to join the AutoLenis marketplace. Reach pre-qualified buyers actively searching for vehicles in your area.",
    path: "/dealer-application",
    keywords: ["AutoLenis dealer", "dealer application", "sell cars AutoLenis", "marketplace dealer"],
  },
  hope: {
    title: "Hope",
    description: "Words of encouragement, hope, and faith from the AutoLenis team.",
    path: "/hope",
    // Intentionally not indexed — System 25 brand differentiation page reachable
    // via direct link only.
    noindex: true,
  },
  refinanceIneligible: {
    title: "Refinance Not Available",
    description:
      "AutoLenis refinance is not available based on the information provided. Check back soon.",
    path: "/refinance/ineligible",
    // Transactional outcome page — should not be indexed.
    noindex: true,
  },
  prequalConsent: {
    title: "Prequalification Consent",
    description: "FCRA disclosure and consent for AutoLenis credit prequalification.",
    path: "/legal/prequal-consent",
  },
  affiliateTerms: {
    title: "Affiliate Terms",
    description: "AutoLenis Affiliate Network terms, commission structure, and payout policies.",
    path: "/legal/affiliate-terms",
  },
  dealerTerms: {
    title: "Dealer Terms",
    description: "AutoLenis marketplace dealer terms, referral fees, and platform policies.",
    path: "/legal/dealer-terms",
  },
  cookiePolicy: {
    title: "Cookie Policy",
    description: "How AutoLenis uses cookies, tracking, and analytics on our platform.",
    path: "/legal/cookie-policy",
  },
} as const;

export const APP_URL_EXPORT = APP_URL;

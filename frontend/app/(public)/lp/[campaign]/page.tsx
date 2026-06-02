import type { Metadata } from "next";
import LandingPageClient from "./LandingPageClient";
import { JsonLd, organizationSchema } from "@/lib/seo/jsonld";
import { generateFaqSchema } from "@/lib/services/seo/seo-schema.service";

// Force dynamic rendering — LP content is campaign-specific
export const dynamic = "force-dynamic";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Campaign-channel headline map. Each channel gets a sharp 3–6 word authority
// headline (Part 11). New campaigns fall back to `default`.
const CAMPAIGN_HEADLINES: Record<string, { h1: string; sub: string }> = {
  facebook: {
    h1: "Stop Negotiating Alone.",
    sub: "Verified dealers compete for your business in a private 48-hour auction.",
  },
  google: {
    h1: "Dealers Compete. You Choose.",
    sub: "Submit your vehicle request. Verified dealers send competing offers within 48 hours.",
  },
  tiktok: {
    h1: "The Table Just Turned.",
    sub: "Dealers compete for your business. You compare offers from home — no showroom, no pressure.",
  },
  youtube: {
    h1: "Take Back Control of Car Buying.",
    sub: "AutoLenis activates a private 48-hour dealer auction. Multiple offers. One decision — yours.",
  },
  default: {
    h1: "Where Dealers Compete for You.",
    sub: "A private 48-hour dealer auction. Verified offers. You choose on your terms.",
  },
};

const CAMPAIGN_META: Record<string, { title: string; description: string }> = {
  facebook: {
    title: "Stop Negotiating Alone — AutoLenis | Dealers Compete for You",
    description:
      "AutoLenis lets verified dealers compete privately for your business. Compare real offers side-by-side. No showroom. No pressure. Start your 48-hour dealer auction today.",
  },
  google: {
    title: "Dealers Compete. You Choose. | AutoLenis",
    description:
      "Submit one vehicle request. Verified dealers send competing offers within 48 hours. Compare cash price, monthly payment, and total cost side-by-side. Start free.",
  },
  tiktok: {
    title: "The Table Just Turned | AutoLenis",
    description:
      "Dealers compete for your business from your couch. No showroom visits. No pressure. AutoLenis activates a private 48-hour auction. You compare. You choose.",
  },
  youtube: {
    title: "Take Back Control of Car Buying | AutoLenis",
    description:
      "AutoLenis activates a private 48-hour dealer auction for any vehicle you want. Multiple offers. Full transparency. One decision — yours. Start for free.",
  },
  default: {
    title: "Where Dealers Compete for You | AutoLenis",
    description:
      "A private 48-hour dealer auction. Verified offers. You compare every offer side-by-side — cash price, financing, fees. AutoLenis puts you in control. Start free.",
  },
};

const LP_FAQS = [
  {
    q: "Is AutoLenis a dealership?",
    a: "No. AutoLenis is a buyer-first automotive concierge platform. We are not a dealership, broker, or lender. We connect buyers with verified independent dealers who compete for your business through a private reverse auction.",
  },
  {
    q: "Do dealers compete privately?",
    a: "Yes. All dealer bids are submitted privately through the AutoLenis platform. Dealers cannot see each other's offers, which drives genuine competition for the buyer's business.",
  },
  {
    q: "Does this affect my credit score?",
    a: "No. Submitting a vehicle request through AutoLenis does not affect your credit score. AutoLenis performs a soft prequalification only. Any hard credit pull would only occur if you choose to proceed with financing through a dealer.",
  },
  {
    q: "What is the Auction Access Fee?",
    a: "The $99 Auction Access Fee is a one-time, non-refundable fee that activates your private 48-hour dealer auction. It signals seriousness to verified dealers. It is not a deposit and is not credited toward your vehicle purchase.",
  },
  {
    q: "How is AutoLenis different from other car buying services?",
    a: "AutoLenis is the only platform that runs a true private reverse auction where verified dealers compete for your business. You compare structured offers side-by-side — including cash price, financing terms, and fee breakdowns — with dealer identity anonymized until you choose.",
  },
  {
    q: "Can I finance through AutoLenis?",
    a: "AutoLenis coordinates financing as part of the concierge process. We work with your selected dealer on financing options. For refinancing existing vehicles, AutoLenis connects buyers with OpenRoad Lending.",
  },
];

export async function generateMetadata(
  { params }: { params: Promise<{ campaign: string }> },
): Promise<Metadata> {
  const { campaign } = await params;
  const slug = (campaign ?? "default").toLowerCase();
  const meta = CAMPAIGN_META[slug] ?? CAMPAIGN_META.default;
  const url = `${APP_URL}/lp/${slug}`;
  const ogImage = `${APP_URL}/og-lp.jpg`;

  return {
    title: meta.title,
    description: meta.description,
    // noindex (paid funnel — never compete with the organic hub), but follow so
    // link equity flows through to /car-buying-service/* via the footer bridge.
    robots: {
      index: false,
      follow: true,
      noarchive: true,
      nosnippet: false,
    },
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url,
      siteName: "AutoLenis",
      type: "website",
      locale: "en_US",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: "AutoLenis — Where Dealers Compete for You",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [ogImage],
    },
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  const { campaign } = await params;
  const slug = (campaign ?? "default").toLowerCase();
  const headlines = CAMPAIGN_HEADLINES[slug] ?? CAMPAIGN_HEADLINES.default;
  const meta = CAMPAIGN_META[slug] ?? CAMPAIGN_META.default;
  const pageUrl = `${APP_URL}/lp/${slug}`;

  return (
    <>
      <JsonLd
        id="lp-webpage"
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          "@id": pageUrl,
          url: pageUrl,
          name: meta.title,
          description: meta.description,
          isPartOf: {
            "@type": "WebSite",
            "@id": APP_URL,
            url: APP_URL,
            name: "AutoLenis",
          },
          breadcrumb: {
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: APP_URL,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Start Your Vehicle Request",
                item: pageUrl,
              },
            ],
          },
          inLanguage: "en-US",
          potentialAction: {
            "@type": "Action",
            name: "Start Vehicle Request",
            target: `${pageUrl}#request`,
          },
        }}
      />
      <JsonLd
        id="lp-service"
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "AutoLenis Automotive Concierge",
          serviceType: "Automotive Buying Concierge",
          description:
            "AutoLenis connects car buyers with verified dealers through a private 48-hour reverse auction. Buyers submit one vehicle request and receive competing offers from multiple dealers.",
          provider: {
            "@type": "Organization",
            name: "AutoLenis",
            url: APP_URL,
          },
          areaServed: {
            "@type": "Country",
            name: "United States",
          },
          audience: {
            "@type": "Audience",
            audienceType: "Car Buyers",
          },
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
            description:
              "Free to submit a vehicle request. A one-time $99 non-refundable Auction Access Fee activates dealer competition.",
            priceSpecification: {
              "@type": "PriceSpecification",
              price: "99",
              priceCurrency: "USD",
              description:
                "One-time, non-refundable Auction Access Fee — not a deposit, not credited toward purchase",
            },
          },
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "AutoLenis Buyer Plans",
            itemListElement: [
              {
                "@type": "Offer",
                itemOffered: {
                  "@type": "Service",
                  name: "Standard Plan",
                  description:
                    "Free to start. A one-time $99 non-refundable Auction Access Fee activates your 48-hour dealer auction. Not a deposit; not credited toward purchase.",
                },
              },
              {
                "@type": "Offer",
                itemOffered: {
                  "@type": "Service",
                  name: "Premium Concierge Plan",
                  description:
                    "Full concierge service with dedicated support, contract review, and financing coordination.",
                },
              },
            ],
          },
        }}
      />
      <JsonLd id="lp-faq" data={generateFaqSchema(LP_FAQS)} />
      <JsonLd id="lp-org" data={organizationSchema()} />
      <LandingPageClient
        campaign={slug}
        headline={headlines.h1}
        subheadline={headlines.sub}
      />
    </>
  );
}

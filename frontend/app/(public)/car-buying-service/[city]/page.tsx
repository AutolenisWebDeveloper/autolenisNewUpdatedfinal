// ───────────────────────────────────────────────────────────────────────────
//  /car-buying-service/[city] — programmatic CITY pages (10 markets)
//
//  Server Component. Indexable, self-canonical, statically generated from
//  SEO_LOCATIONS via generateStaticParams. notFound() if the slug isn't in the
//  dataset OR fails the uniqueness bar (hasPublishableContent) — making thin
//  doorway pages structurally impossible.
//
//  Each page renders the SHARED template + genuinely unique local content
//  (<LocalSection>) + <NearbyCitiesGrid> (haversine-nearest cities). One <h1>.
// ───────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";
import {
  breadcrumbSchema,
  professionalServiceSchema,
  serviceOfferingSchemas,
  howToSchema,
  faqSchema,
} from "@/lib/seo/jsonld";
import {
  SEO_LOCATIONS,
  getLocationBySlug,
  hasPublishableContent,
  cityFormSource,
} from "@/lib/seo/locations";
import JsonLdScript from "@/components/seo/landing/JsonLdScript";
import SeoHero from "@/components/seo/landing/SeoHero";
import Breadcrumbs from "@/components/seo/landing/Breadcrumbs";
import HowItWorksReverseAuction from "@/components/seo/landing/HowItWorksReverseAuction";
import WhatWeDoConcierge from "@/components/seo/landing/WhatWeDoConcierge";
import TrustIndependence from "@/components/seo/landing/TrustIndependence";
import ComparisonTable from "@/components/seo/landing/ComparisonTable";
import SavingsCallout from "@/components/seo/landing/SavingsCallout";
import LocalSection from "@/components/seo/landing/LocalSection";
import NearbyCitiesGrid from "@/components/seo/landing/NearbyCitiesGrid";
import SeoFaqSection from "@/components/seo/landing/SeoFaqSection";
import FinalCta from "@/components/seo/landing/FinalCta";
import { CORE_FAQS, REVERSE_AUCTION_STEPS } from "@/components/seo/landing/content";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const HUB_PATH = "/car-buying-service/texas";

// Pre-render every market at build time.
export function generateStaticParams() {
  return SEO_LOCATIONS.map((l) => ({ city: l.slug }));
}

// Only publish known, content-complete slugs.
export const dynamicParams = false;

export async function generateMetadata(
  { params }: { params: Promise<{ city: string }> },
): Promise<Metadata> {
  const { city } = await params;
  const loc = getLocationBySlug(city);
  if (!loc || !hasPublishableContent(loc)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  return buildPageMetadata({
    title: `Car Buying Service in ${loc.city}, ${loc.stateAbbr} — Dealers Compete, We Negotiate`,
    description:
      `AutoLenis is a buyer-side car-buying concierge in ${loc.city}, ${loc.stateAbbr}. Dealers compete for you in a private reverse auction while we negotiate. Start your free request.`,
    path: `/car-buying-service/${loc.slug}`,
    keywords: [
      `car broker ${loc.city}`,
      `car buying service ${loc.city}`,
      `auto concierge ${loc.city} ${loc.stateAbbr}`,
      "car buying concierge",
      "negotiate car price for me",
    ],
  });
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const loc = getLocationBySlug(city);

  // Dataset miss OR thin content → 404 (doorway-page safety).
  if (!loc || !hasPublishableContent(loc)) {
    notFound();
  }

  const pageUrl = `${APP_URL}/car-buying-service/${loc.slug}`;
  const cityArea = [{ city: loc.city, state: loc.state }];
  const visibleFaqs = [...loc.localFaqs, ...CORE_FAQS.slice(0, 3)];

  // The Texas state hub is the only organic state hub today, so only Texas
  // markets link their "Car Buying Service" / state breadcrumb to it. Other
  // states render the state name as a non-linked crumb until a hub exists.
  const isTx = loc.stateAbbr === "TX";
  const serviceCrumbPath = isTx ? HUB_PATH : undefined;

  return (
    <>
      <JsonLdScript
        id="city-breadcrumb"
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Car Buying Service", ...(serviceCrumbPath ? { path: serviceCrumbPath } : {}) },
          { name: loc.state, ...(serviceCrumbPath ? { path: serviceCrumbPath } : {}) },
          { name: loc.city, path: `/car-buying-service/${loc.slug}` },
        ])}
      />
      <JsonLdScript
        id="city-professional-service"
        data={professionalServiceSchema({
          pageUrl,
          name: `AutoLenis Car Buying Service — ${loc.city}, ${loc.stateAbbr}`,
          description:
            `Buyer-side car-buying concierge and reverse-auction platform serving ${loc.city}, ${loc.stateAbbr} and the ${loc.metro} metro. Dealers compete for your business; we negotiate on your behalf.`,
          cities: cityArea,
          idSuffix: loc.slug,
        })}
      />
      <JsonLdScript id="city-services" data={serviceOfferingSchemas({ cities: cityArea })} />
      <JsonLdScript
        id="city-howto"
        data={howToSchema({
          name: "How AutoLenis's reverse auction works",
          description:
            `Submit one request and verified dealers compete for your business in ${loc.city} while AutoLenis negotiates on your behalf.`,
          steps: REVERSE_AUCTION_STEPS,
        })}
      />
      <JsonLdScript
        id="city-faq"
        data={faqSchema(visibleFaqs.map((f) => ({ question: f.q, answer: f.a })))}
      />

      <Breadcrumbs
        items={[
          { name: "Home", href: "/" },
          { name: "Car Buying Service", href: serviceCrumbPath },
          { name: loc.state, href: serviceCrumbPath },
          { name: loc.city },
        ]}
      />

      <SeoHero
        source={cityFormSource(loc.slug)}
        h1={`Car Buying Service in ${loc.city}, ${loc.stateAbbr} — Dealers Compete, We Negotiate`}
        subhead={`Skip the dealership grind in ${loc.city}. AutoLenis is your buyer-side concierge — tell us the vehicle you want and verified ${loc.metro} dealers compete for your business while we negotiate the price.`}
        entityDefinition={`AutoLenis is a buyer-side car-buying concierge and reverse-auction platform serving ${loc.city}, ${loc.stateAbbr}. We represent you — not the dealer.`}
        heroImage={loc.heroImage}
        heroImageAlt={loc.heroImageAlt}
      />

      <HowItWorksReverseAuction />
      <WhatWeDoConcierge />
      <LocalSection location={loc} />
      <TrustIndependence />
      <ComparisonTable />
      <SavingsCallout city={loc.city} />
      <NearbyCitiesGrid slug={loc.slug} />
      <SeoFaqSection faqs={visibleFaqs} heading={`${loc.city} car-buying questions`} />
      <FinalCta
        headline={`Let dealers compete for your business in ${loc.city}`}
      />
    </>
  );
}

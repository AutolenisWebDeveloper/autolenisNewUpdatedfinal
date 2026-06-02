// ───────────────────────────────────────────────────────────────────────────
//  /car-buying-service/texas — canonical organic STATE HUB
//
//  Server Component (no page-level "use client"). Indexable, self-canonical.
//  Composes shared SEO/conversion components + the visible CitiesWeServeGrid
//  that links to all 10 city pages. Exactly one <h1> (in <SeoHero>).
//
//  JSON-LD (server-rendered): BreadcrumbList, ProfessionalService, Service ×4,
//  HowTo, FAQPage. Organization + entity graph are emitted sitewide in the
//  root layout. No AutoDealer; no fabricated ratings.
// ───────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/metadata";
import {
  breadcrumbSchema,
  professionalServiceSchema,
  serviceOfferingSchemas,
  howToSchema,
  faqSchema,
} from "@/lib/seo/jsonld";
import { SEO_LOCATIONS } from "@/lib/seo/locations";
import JsonLdScript from "@/components/seo/landing/JsonLdScript";
import SeoHero from "@/components/seo/landing/SeoHero";
import Breadcrumbs from "@/components/seo/landing/Breadcrumbs";
import HowItWorksReverseAuction from "@/components/seo/landing/HowItWorksReverseAuction";
import WhatWeDoConcierge from "@/components/seo/landing/WhatWeDoConcierge";
import TrustIndependence from "@/components/seo/landing/TrustIndependence";
import ComparisonTable from "@/components/seo/landing/ComparisonTable";
import SavingsCallout from "@/components/seo/landing/SavingsCallout";
import CitiesWeServeGrid from "@/components/seo/landing/CitiesWeServeGrid";
import SeoFaqSection from "@/components/seo/landing/SeoFaqSection";
import FinalCta from "@/components/seo/landing/FinalCta";
import { CORE_FAQS, REVERSE_AUCTION_STEPS } from "@/components/seo/landing/content";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const PATH = "/car-buying-service/texas";
const PAGE_URL = `${APP_URL}${PATH}`;

const ALL_CITIES = SEO_LOCATIONS.map((l) => ({ city: l.city, state: "Texas" }));

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Car Buying Service in Texas — Dealers Compete, We Negotiate",
    description:
      "AutoLenis is a buyer-side car-buying concierge in Texas. Dealers compete for you in a private reverse auction while we negotiate price. Start your free request.",
    path: PATH,
    keywords: [
      "car buying service texas",
      "car broker texas",
      "auto concierge texas",
      "car buying concierge",
      "reverse auction car buying",
      "negotiate car price for me",
    ],
  });
}

export default function TexasHubPage() {
  return (
    <>
      <JsonLdScript
        id="cbs-breadcrumb"
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Car Buying Service", path: PATH },
          { name: "Texas", path: PATH },
        ])}
      />
      <JsonLdScript
        id="cbs-professional-service"
        data={professionalServiceSchema({
          pageUrl: PAGE_URL,
          name: "AutoLenis Car Buying Service — Texas",
          description:
            "Buyer-side car-buying concierge and reverse-auction platform serving the Texas market. Dealers compete for your business; we negotiate on your behalf.",
          cities: ALL_CITIES,
          idSuffix: "texas",
        })}
      />
      <JsonLdScript id="cbs-services" data={serviceOfferingSchemas({ cities: ALL_CITIES })} />
      <JsonLdScript
        id="cbs-howto"
        data={howToSchema({
          name: "How AutoLenis's reverse auction works",
          description:
            "Submit one request and verified dealers compete for your business while AutoLenis negotiates on your behalf.",
          steps: REVERSE_AUCTION_STEPS,
        })}
      />
      <JsonLdScript
        id="cbs-faq"
        data={faqSchema(CORE_FAQS.map((f) => ({ question: f.q, answer: f.a })))}
      />

      <Breadcrumbs
        items={[
          { name: "Home", href: "/" },
          { name: "Car Buying Service", href: PATH },
          { name: "Texas" },
        ]}
      />

      <SeoHero
        source="seo_texas_hub"
        h1="Car Buying Service in Texas — Dealers Compete, We Negotiate"
        subhead="AutoLenis is your buyer-side concierge. Tell us the vehicle you want, and verified Texas dealers compete for your business in a private reverse auction while we negotiate the price."
        entityDefinition="AutoLenis is a buyer-side car-buying concierge and reverse-auction platform serving buyers across Texas and the Dallas-Fort Worth metro. We represent you — not the dealer."
        heroImage="/images/seo/state-texas-hero.jpg"
        heroImageAlt="Car buying service in Texas — AutoLenis concierge"
      />

      <HowItWorksReverseAuction />
      <WhatWeDoConcierge />
      <TrustIndependence />
      <ComparisonTable />
      <SavingsCallout />
      <CitiesWeServeGrid />
      <SeoFaqSection faqs={CORE_FAQS} />
      <FinalCta />
    </>
  );
}

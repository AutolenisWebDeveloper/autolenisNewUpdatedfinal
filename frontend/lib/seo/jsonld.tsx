import Script from "next/script";

interface JsonLdProps { id: string; data: Record<string, unknown> | Array<Record<string, unknown>> }

export function JsonLd({ id, data }: JsonLdProps) {
  return (
    <Script id={id} type="application/ld+json" strategy="beforeInteractive">
      {JSON.stringify(data)}
    </Script>
  );
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// ── Canonical NAP (Name / Address / Phone) ────────────────────────────────
// Single source of truth for structured data. Keep in lockstep with
// components/public/PublicFooter.tsx for local-SEO citation consistency.
// Schema-format phone uses the local Frisco number ONLY (the toll-free
// 866 line is display-only and never enters structured data).
export const AUTOLENIS_NAP = {
  name: "AutoLenis, Inc.",
  streetAddress: "12800 Westridge Blvd Suite 114",
  addressLocality: "Frisco",
  addressRegion: "TX",
  postalCode: "75035",
  addressCountry: "US",
  telephone: "+1-469-535-9785",
  // Frisco HQ coordinates.
  latitude: 33.1507,
  longitude: -96.8236,
} as const;

// {{CONFIRM_WITH_OWNER}} — populate with real social profile URLs
// (Facebook, Instagram, X, LinkedIn, YouTube) before launch.
export const AUTOLENIS_SAMEAS: string[] = [];

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${APP_URL}/#organization`,
    name: AUTOLENIS_NAP.name,
    url: APP_URL,
    logo: `${APP_URL}/logo.png`,
    description: "Buyer-side car-buying concierge and reverse-auction platform",
    telephone: AUTOLENIS_NAP.telephone,
    address: {
      "@type": "PostalAddress",
      streetAddress: AUTOLENIS_NAP.streetAddress,
      addressLocality: AUTOLENIS_NAP.addressLocality,
      addressRegion: AUTOLENIS_NAP.addressRegion,
      postalCode: AUTOLENIS_NAP.postalCode,
      addressCountry: AUTOLENIS_NAP.addressCountry,
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: AUTOLENIS_NAP.telephone,
      contactType: "customer support",
      areaServed: "US",
      availableLanguage: "English",
    },
    sameAs: AUTOLENIS_SAMEAS,
  };
}

export function localBusinessSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: AUTOLENIS_NAP.name,
    url: APP_URL,
    image: `${APP_URL}/og-image.jpg`,
    telephone: AUTOLENIS_NAP.telephone,
    address: {
      "@type": "PostalAddress",
      streetAddress: AUTOLENIS_NAP.streetAddress,
      addressLocality: AUTOLENIS_NAP.addressLocality,
      addressRegion: AUTOLENIS_NAP.addressRegion,
      postalCode: AUTOLENIS_NAP.postalCode,
      addressCountry: AUTOLENIS_NAP.addressCountry,
    },
    geo: { "@type": "GeoCoordinates", latitude: AUTOLENIS_NAP.latitude, longitude: AUTOLENIS_NAP.longitude },
    areaServed: { "@type": "State", name: "Texas" },
    description: "Buyer-side car-buying concierge serving the Texas market — reverse auctions where dealers compete for your business.",
    priceRange: "$$",
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: APP_URL,
    name: "AutoLenis",
    potentialAction: {
      "@type": "SearchAction",
      target: `${APP_URL}/inventory?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

interface VehicleSchemaInput {
  vehicleId: string; year: number; make: string; model: string; trim: string | null;
  mileage: number | null; priceCents: number; vin: string | null; bodyType: string | null;
  fuelType: string | null; transmission: string | null; drivetrain: string | null;
  exteriorColor: string | null; images: string[];
}

export function vehicleSchema(v: VehicleSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Car",
    name: `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`,
    vehicleModelDate: String(v.year),
    brand: { "@type": "Brand", name: v.make },
    model: v.model,
    ...(v.trim ? { vehicleConfiguration: v.trim } : {}),
    ...(v.bodyType ? { bodyType: v.bodyType } : {}),
    ...(v.vin ? { vehicleIdentificationNumber: v.vin } : {}),
    ...(v.fuelType ? { fuelType: v.fuelType } : {}),
    ...(v.transmission ? { vehicleTransmission: v.transmission } : {}),
    ...(v.drivetrain ? { driveWheelConfiguration: v.drivetrain } : {}),
    ...(v.exteriorColor ? { color: v.exteriorColor } : {}),
    ...(v.mileage !== null ? { mileageFromOdometer: { "@type": "QuantitativeValue", value: v.mileage, unitCode: "SMI" } } : {}),
    image: v.images.slice(0, 10),
    offers: {
      "@type": "Offer",
      price: (v.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${APP_URL}/inventory/${v.vehicleId}`,
    },
  };
}

export function pricingSchema() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "AutoLenis Free Tier",
      description: "Reverse auction with a one-time $99 non-refundable Auction Access Fee and full Contract Shield protection.",
      offers: {
        "@type": "Offer",
        price: "99.00",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "PriceSpecification",
          price: "99.00",
          priceCurrency: "USD",
          valueAddedTaxIncluded: false,
          description: "One-time, non-refundable Auction Access Fee — not a deposit and not credited toward purchase.",
        },
        availability: "https://schema.org/InStock",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "AutoLenis Premium Concierge",
      description: "White-glove car-buying concierge with dedicated specialist, full negotiation, paperwork handling, and delivery.",
      offers: {
        "@type": "Offer",
        price: "499.00",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "PriceSpecification",
          price: "499.00",
          priceCurrency: "USD",
          valueAddedTaxIncluded: false,
        },
        availability: "https://schema.org/InStock",
      },
    },
  ];
}

// ── Phase C0 — content engine builders (Person + Article) ─────────────────────

interface PersonSchemaInput {
  name: string;
  jobTitle: string;
  url: string;
  worksFor?: string;
}

/** Person schema for the named author (E-E-A-T signal). */
export function personSchema(input: PersonSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    jobTitle: input.jobTitle,
    worksFor: { "@type": "Organization", name: input.worksFor ?? "AutoLenis" },
    url: input.url,
    sameAs: [APP_URL],
  };
}

interface ArticleSchemaInput {
  headline: string;
  description: string;
  slug: string;
  authorName?: string;
  authorUrl?: string;
  datePublished?: string;
  dateModified?: string;
}

/** Article schema with author reference for buying-guide content. */
export function articleSchema(input: ArticleSchemaInput) {
  const url = `${APP_URL}/buying-guide/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    author: {
      "@type": "Person",
      name: input.authorName ?? "Markist",
      url: input.authorUrl ?? `${APP_URL}/author/markist`,
    },
    publisher: {
      "@type": "Organization",
      name: AUTOLENIS_NAP.name,
      logo: { "@type": "ImageObject", url: `${APP_URL}/logo.png` },
    },
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    dateModified: input.dateModified ?? input.datePublished ?? undefined,
  };
}

interface FaqItem { question: string; answer: string }
export function faqSchema(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(i => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

export function breadcrumbSchema(crumbs: Array<{ name: string; path?: string; url?: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => {
      const item = c.url ?? (c.path ? `${APP_URL}${c.path}` : undefined);
      return {
        "@type": "ListItem",
        position: i + 1,
        name: c.name,
        ...(item ? { item } : {}),
      };
    }),
  };
}

interface ItemListInput {
  name: string;
  items: Array<{ url: string; name: string }>;
}
export function itemListSchema({ name, items }: ItemListInput) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: it.url,
      name: it.name,
    })),
  };
}

interface AggregateOfferInput {
  name: string;
  offerCount: number;
  lowPriceCents: number;
  highPriceCents: number;
}
export function aggregateOfferSchema({ name, offerCount, lowPriceCents, highPriceCents }: AggregateOfferInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: (lowPriceCents / 100).toFixed(2),
      highPrice: (highPriceCents / 100).toFixed(2),
      offerCount,
      availability: "https://schema.org/InStock",
    },
  };
}

interface ReviewSchemaInput {
  itemName: string;
  reviewCount: number;
  ratingValue: number;
  ratingMax?: number;
}
export function reviewSchema(opts: ReviewSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: opts.itemName,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: opts.ratingValue,
      ratingCount: opts.reviewCount,
      bestRating: opts.ratingMax ?? 5,
      worstRating: 1,
    },
  };
}

export function serviceSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "AutoLenis Car Buying Concierge",
    provider: { "@type": "Organization", name: "AutoLenis", url: APP_URL },
    serviceType: "Automotive Concierge",
    areaServed: { "@type": "Country", name: "United States" },
    description: "Private reverse auction car buying platform. Dealers compete for pre-qualified buyers.",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "99.00",
      highPrice: "499.00",
      offerCount: 2,
    },
  };
}

export function contractShieldServiceSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Contract Shield™",
    provider: { "@type": "Organization", name: "AutoLenis", url: APP_URL },
    description: "AutoLenis reviews every dealer contract for junk fees, APR accuracy, and hidden charges before you sign.",
    serviceType: "Automotive Contract Review",
    areaServed: "US",
    url: `${APP_URL}/contract-shield`,
  };
}

export function aboutPageSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About AutoLenis",
    description: "AutoLenis was built to eliminate dealership negotiation and give car buyers the power of competitive bidding.",
    url: `${APP_URL}/about`,
  };
}

export function contactPageSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: "Contact AutoLenis",
    url: `${APP_URL}/contact`,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      areaServed: "US",
      availableLanguage: "English",
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  Tier-2 builders for the /car-buying-service hybrid SEO system.
//  AutoLenis is a service-area business (buyer-side concierge), NOT a dealer —
//  so we use ProfessionalService + Service with `areaServed`, never AutoDealer
//  and never a fake storefront address. No aggregateRating until real,
//  on-page, owner-confirmed review data exists ({{CONFIRM_WITH_OWNER}}).
// ───────────────────────────────────────────────────────────────────────────

const ORG_ID = `${APP_URL}/#organization`;

interface AreaServedCity { city: string; state?: string }

/**
 * Build an `areaServed` array: a State node for each distinct state represented
 * by the cities (defaulting to Texas for the legacy state hub when no city
 * carries a state), plus a City node per city. National-expansion safe — a
 * Los Angeles page no longer falsely claims Texas as its service area.
 */
function buildAreaServed(cities: AreaServedCity[]) {
  const states = Array.from(
    new Set(cities.map(c => c.state).filter((s): s is string => Boolean(s))),
  );
  const stateNodes = (states.length ? states : ["Texas"]).map(name => ({
    "@type": "State",
    name,
  }));
  return [
    ...stateNodes,
    ...cities.map(c => ({
      "@type": "City",
      name: c.city,
      ...(c.state ? { containedInPlace: { "@type": "State", name: c.state } } : {}),
    })),
  ];
}

interface ProfessionalServiceInput {
  /** Canonical URL of the page this schema is embedded on. */
  pageUrl: string;
  /** Human label, e.g. "Car Buying Service in Frisco, TX". */
  name: string;
  description: string;
  /** Cities to include in areaServed (besides the always-present State). */
  cities: AreaServedCity[];
  /** Optional id suffix so multiple graphs on a site stay unique. */
  idSuffix: string;
}

/**
 * ProfessionalService for a service-area business. Links to the Organization
 * @id. priceRange included; aggregateRating deliberately omitted.
 */
export function professionalServiceSchema(input: ProfessionalServiceInput) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${input.pageUrl}#service-${input.idSuffix}`,
    name: input.name,
    url: input.pageUrl,
    description: input.description,
    image: `${APP_URL}/og-image.jpg`,
    telephone: AUTOLENIS_NAP.telephone,
    priceRange: "$$",
    parentOrganization: { "@id": ORG_ID },
    provider: { "@id": ORG_ID },
    address: {
      "@type": "PostalAddress",
      addressRegion: AUTOLENIS_NAP.addressRegion,
      addressCountry: AUTOLENIS_NAP.addressCountry,
    },
    areaServed: buildAreaServed(input.cities),
  };
}

const SERVICE_OFFERINGS: { serviceType: string; description: string }[] = [
  { serviceType: "Car Buying Concierge", description: "A buyer's agent who manages the entire car-buying process on your behalf — from search to signing." },
  { serviceType: "Car Price Negotiation", description: "We negotiate price, fees, and terms so you never have to haggle at a dealership." },
  { serviceType: "Vehicle Sourcing", description: "We locate hard-to-find vehicles across dealer inventory and dealer auctions." },
  { serviceType: "Dealer Auction Access", description: "We run a private reverse auction where verified dealers compete for your business." },
];

interface ServiceOfferingInput {
  cities: AreaServedCity[];
}

/** One Service node per offering, each provided by the Organization @id. */
export function serviceOfferingSchemas(input: ServiceOfferingInput) {
  const area = buildAreaServed(input.cities);
  return SERVICE_OFFERINGS.map(s => ({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: s.serviceType,
    name: s.serviceType,
    description: s.description,
    provider: { "@id": ORG_ID },
    areaServed: area,
  }));
}

interface HowToStep { name: string; text: string }
interface HowToInput {
  name: string;
  description: string;
  steps: HowToStep[];
}

/** HowTo for the reverse-auction flow. */
export function howToSchema(input: HowToInput) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

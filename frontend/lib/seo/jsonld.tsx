import Script from "next/script";

interface JsonLdProps { id: string; data: Record<string, unknown> | Array<Record<string, unknown>> }

export function JsonLd({ id, data }: JsonLdProps) {
  return (
    <Script id={id} type="application/ld+json" strategy="beforeInteractive">
      {JSON.stringify(data)}
    </Script>
  );
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "AutoLenis",
    url: APP_URL,
    logo: `${APP_URL}/logo.png`,
    description: "Premium automotive concierge and reverse-auction platform",
    address: { "@type": "PostalAddress", addressLocality: "Plano", addressRegion: "TX", addressCountry: "US" },
    sameAs: [],
  };
}

export function localBusinessSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "AutoLenis",
    url: APP_URL,
    image: `${APP_URL}/og-image.jpg`,
    address: { "@type": "PostalAddress", addressLocality: "Plano", addressRegion: "TX", postalCode: "75024", addressCountry: "US" },
    geo: { "@type": "GeoCoordinates", latitude: 33.0795, longitude: -96.8088 },
    areaServed: { "@type": "State", name: "Texas" },
    description: "Premium car-buying concierge serving the Texas market — reverse auctions where dealers compete for your business.",
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
      description: "Reverse auction with $99 refundable deposit and full Contract Shield protection.",
      offers: {
        "@type": "Offer",
        price: "99.00",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "PriceSpecification",
          price: "99.00",
          priceCurrency: "USD",
          valueAddedTaxIncluded: false,
          description: "Refundable deposit, returned at deal completion or auction end.",
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

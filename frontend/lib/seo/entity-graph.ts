// AutoLenis Connected Entity Graph
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for every schema.org @id used across the site.
// Every JSON-LD object must reference these IDs so the Google Knowledge Graph
// understands all entities as parts of one connected business graph.

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// ─── Canonical Entity IDs ─────────────────────────────────────────────────────
// Every entity on the site must reference these exact IDs.
// Never create a new @id — always reuse from this registry.

export const ENTITY_IDS = {
  organization:        `${BASE}/#organization`,
  website:             `${BASE}/#website`,
  localBusiness:       `${BASE}/#local-business`,
  founder:             `${BASE}/#founder`,
  carBuyingService:    `${BASE}/#car-buying-service`,
  depositService:      `${BASE}/#deposit-service`,
  serviceFeeOffer:     `${BASE}/#service-fee-offer`,
  howItWorks:          `${BASE}/how-it-works#how-it-works`,
  faqPage:             `${BASE}/faq#faq-page`,
  aboutPage:           `${BASE}/about#about-page`,
  inventoryPage:       `${BASE}/inventory#inventory-page`,
  pricingPage:         `${BASE}/pricing#pricing-page`,
  vehicleCategory:     (slug: string) => `${BASE}/#vehicle-category-${slug}`,
  cityPage:            (slug: string) => `${BASE}/car-buying-concierge/${slug}#service-area`,
  vehicleListing:      (id: string) => `${BASE}/inventory/${id}#vehicle`,
  faqItem:             (id: string) => `${BASE}/faq#faq-${id}`,
  blogPost:            (slug: string) => `${BASE}/blog/${slug}#article`,
} as const;

// ─── Connected Entity Graph ───────────────────────────────────────────────────
// Defines the semantic relationships between all entities on the site.
// Rendered once in the root layout — every other page can reference IDs from
// this graph without duplicating the entity definitions.

export const entityGraphSchema: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@graph": [
    // Organization — the root entity
    {
      "@type": ["Organization", "LocalBusiness", "FinancialService"],
      "@id": ENTITY_IDS.organization,
      name: "AutoLenis",
      url: BASE,
      logo: { "@type": "ImageObject", url: `${BASE}/logo.png`, width: 400, height: 120 },
      foundingDate: "2024",
      founder: { "@id": ENTITY_IDS.founder },
      makesOffer: [
        { "@id": ENTITY_IDS.depositService },
        { "@id": ENTITY_IDS.serviceFeeOffer },
      ],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "AutoLenis Car Buying Concierge Services",
        itemListElement: [{ "@id": ENTITY_IDS.carBuyingService }],
      },
      knowsAbout: [
        "Car Buying Concierge",
        "Auto Broker Services",
        "Vehicle Pre-Qualification",
        "Dealer Auctions",
        "Automotive Finance",
        "Vehicle Trade-In",
      ],
      sameAs: [
        "https://www.facebook.com/autolenis",
        "https://www.instagram.com/autolenis",
        "https://twitter.com/autolenis",
        "https://www.linkedin.com/company/autolenis",
      ],
    },

    // Founder — connected to organization
    {
      "@type": "Person",
      "@id": ENTITY_IDS.founder,
      name: "Markist Athelus",
      jobTitle: "Founder & CEO",
      worksFor: { "@id": ENTITY_IDS.organization },
      url: `${BASE}/about`,
      knowsAbout: [
        "Fintech",
        "Automotive Finance",
        "Car Buying",
        "Auto Broker Services",
        "Vehicle Marketplace Platforms",
      ],
      sameAs: [`${BASE}/about`],
    },

    // Primary Service — connected to organization + how-it-works
    {
      "@type": "Service",
      "@id": ENTITY_IDS.carBuyingService,
      name: "Car Buying Concierge Service",
      serviceType: "Automotive Buying Concierge",
      provider: { "@id": ENTITY_IDS.organization },
      areaServed: { "@type": "Country", name: "United States" },
      url: `${BASE}/how-it-works`,
      description:
        "AutoLenis connects pre-qualified buyers with verified dealers who compete in a private 48-hour auction. Buyers save an average of $2,300.",
      mainEntityOfPage: { "@id": ENTITY_IDS.howItWorks },
    },

    // $99 Auction Access Fee — connected to service
    {
      "@type": "Offer",
      "@id": ENTITY_IDS.depositService,
      name: "Auction Access Fee",
      price: "99.00",
      priceCurrency: "USD",
      description:
        "One-time, non-refundable $99 Auction Access Fee that activates a private 48-hour dealer auction for the buyer. It is not a deposit and is not credited toward a purchase.",
      offeredBy: { "@id": ENTITY_IDS.organization },
      priceValidUntil: "2027-12-31",
      availability: "https://schema.org/InStock",
    },

    // $499 Service Fee — connected to service
    {
      "@type": "Offer",
      "@id": ENTITY_IDS.serviceFeeOffer,
      name: "AutoLenis Service Fee",
      price: "499.00",
      priceCurrency: "USD",
      description:
        "Full AutoLenis concierge fee covering dealer auction management, offer review, contract coordination, and purchase facilitation.",
      offeredBy: { "@id": ENTITY_IDS.organization },
      priceValidUntil: "2027-12-31",
      availability: "https://schema.org/InStock",
    },

    // Website — connected to organization
    {
      "@type": "WebSite",
      "@id": ENTITY_IDS.website,
      url: BASE,
      name: "AutoLenis",
      publisher: { "@id": ENTITY_IDS.organization },
      potentialAction: {
        "@type": "SearchAction",
        target: `${BASE}/inventory?search={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
      inLanguage: "en-US",
    },

    // FAQ Page — connected to service
    {
      "@type": "FAQPage",
      "@id": ENTITY_IDS.faqPage,
      url: `${BASE}/faq`,
      name: "AutoLenis FAQ",
      isPartOf: { "@id": ENTITY_IDS.website },
      about: { "@id": ENTITY_IDS.carBuyingService },
      publisher: { "@id": ENTITY_IDS.organization },
    },

    // HowTo Page — connected to service
    {
      "@type": "HowTo",
      "@id": ENTITY_IDS.howItWorks,
      url: `${BASE}/how-it-works`,
      name: "How AutoLenis Works",
      isPartOf: { "@id": ENTITY_IDS.website },
      about: { "@id": ENTITY_IDS.carBuyingService },
      publisher: { "@id": ENTITY_IDS.organization },
    },
  ],
};

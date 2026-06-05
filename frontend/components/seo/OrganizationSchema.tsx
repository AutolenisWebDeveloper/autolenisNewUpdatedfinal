import { JsonLd } from "@/lib/seo/jsonld";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Phase C0 — sitewide Organization schema for the national content engine.
// Mounted once in the root layout. Establishes AutoLenis as a US-national car
// buying concierge with Markist as founder (E-E-A-T author signal).
const organizationContentSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "AutoLenis",
  url: APP_URL,
  description:
    "AutoLenis is a car buying concierge platform where 8 local dealers " +
    "compete in private 48-hour auctions for qualified buyers anywhere in " +
    "the United States.",
  areaServed: "US",
  founder: {
    "@type": "Person",
    name: "Markist",
  },
  serviceType: "Car Buying Concierge",
};

export default function OrganizationSchema() {
  return <JsonLd id="ld-organization-content" data={organizationContentSchema} />;
}

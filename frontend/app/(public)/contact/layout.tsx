import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, contactPageSchema } from "@/lib/seo/jsonld";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.contact);

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd id="contact-page-jsonld" data={contactPageSchema()} />
      {children}
    </>
  );
}

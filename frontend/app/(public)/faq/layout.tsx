import type { Metadata, Viewport } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { JsonLd, faqSchema } from "@/lib/seo/jsonld";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.faq);
export const revalidate = 86400;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const FAQ_SCHEMA_ITEMS = [
  { question: "How does the $99 deposit work?", answer: "The $99 deposit activates your private 48-hour reverse auction. If no competitive offer is received, or you choose not to proceed, you can request a refund of your $99 — our team reviews every request." },
  { question: "Does the prequalification affect my credit score?", answer: "No. AutoLenis uses a soft-pull prequalification. Soft pulls do not appear on your credit report and do not impact your score." },
  { question: "How many dealers will see my auction?", answer: "Up to 8 vetted dealers are invited per auction, selected on vehicle match, geographic coverage, historical performance, and current capacity." },
  { question: "Do dealers know who I am?", answer: "No. Your identity remains confidential throughout the entire auction. Dealers see only vehicle specs and your pre-qualified budget band." },
  { question: "What is Contract Shield?", answer: "Contract Shield is our automated dealer-contract review. Before you sign anything, we scan for junk fees, APR discrepancies, and hidden add-ons." },
  { question: "What if no dealer submits an offer?", answer: "Your $99 deposit is refunded in full within 3 business days. We may also re-run the auction at no additional cost." },
  { question: "Can I use my own financing?", answer: "Yes. After selecting a deal, you can choose dealer financing, your own bank or credit union pre-approval, or a cash purchase." },
  { question: "How long does the entire process take?", answer: "Most buyers complete the full process in 3–7 days, from prequalification to vehicle pickup." },
];

export default function FAQLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd id="ld-faq" data={faqSchema(FAQ_SCHEMA_ITEMS)} />
      {children}
    </>
  );
}

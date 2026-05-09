import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.dealerTerms);
export default function DealerTermsPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20" data-testid="legal-dealer-terms-page">
      <p className="text-xs tracking-widest uppercase font-semibold text-[#0B5FD1] mb-4">Legal</p>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Dealer Terms of Participation</h1>
      <p className="text-sm text-slate-400 mb-10">Last updated: January 1, 2026</p>
      <div className="prose prose-slate max-w-none space-y-6 text-slate-700 leading-relaxed text-sm">
        <p>These Dealer Terms of Participation (&quot;Dealer Terms&quot;) govern the participation of licensed automobile dealers on the AutoLenis platform. By applying to and participating in the AutoLenis network, you agree to these Dealer Terms in addition to our general Terms of Service.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">1. Dealer Eligibility</h2>
        <p>Participating dealers must hold a valid dealer license in the state(s) in which they operate, maintain required insurance coverage, and have no unresolved consumer complaints with the applicable state DMV or equivalent authority.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">2. Auction Conduct</h2>
        <p>Dealers agree to submit good-faith, competitively-priced offers in response to auction invitations. Offers must reflect the dealer&apos;s genuine intent to sell at the stated price. Shill bidding, incomplete offers, and misleading submissions are prohibited and subject to immediate suspension.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">3. Junk Fee Policy</h2>
        <p>Dealers may not include non-disclosed, non-negotiable add-on products, document preparation fees exceeding $250, or items classified as &quot;junk fees&quot; under the AutoLenis Contract Shield rules. Repeated violations result in tier demotion and auction invitation suspension.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">4. Buyer Identity Confidentiality</h2>
        <p>Buyer identity, contact information, and specific location are confidential until the buyer selects a deal. Dealers must not attempt to identify, contact, or transact with buyers outside the AutoLenis platform.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">5. Deal Completion Requirements</h2>
        <p>When a buyer selects a dealer&apos;s offer, the dealer is obligated to honor the offer at the quoted price and terms, complete the transaction within the agreed timeline, and cooperate with AutoLenis&apos;s Contract Shield review and e-signing processes.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">6. Performance Scoring</h2>
        <p>AutoLenis maintains a dealer scorecard based on offer quality, junk-fee ratio, deal completion rate, and buyer satisfaction. Scorecard performance determines auction invitation frequency and priority tier status.</p>
        <h2 className="text-lg font-semibold text-slate-900 mt-8">7. Termination</h2>
        <p>AutoLenis may suspend or terminate dealer access for violations of these terms, fraudulent activity, persistent low performance scores, or regulatory issues.</p>
      </div>
    </article>
  );
}

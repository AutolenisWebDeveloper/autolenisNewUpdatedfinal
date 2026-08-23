import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Quote, Star } from "lucide-react";
import FaithVerseModule from "@/components/public/FaithVerseModule";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";
import { prisma } from "@/lib/prisma";
import {
  DEPOSIT_AMOUNT_CENTS,
  MAX_DEALER_INVITATIONS,
  AUCTION_DURATION_HOURS,
} from "@/lib/constants";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.testimonials);
export const dynamic = "force-dynamic";
export const revalidate = 86400;

// Phase 4 F2: this page previously shipped fabricated buyer/dealer/affiliate
// testimonials. It now renders ONLY real testimonials that a buyer submitted and
// an admin approved AND published (Testimonial.isApproved && isPublished). When
// none exist yet it shows an honest empty state — never invented quotes. No
// buyer PII is rendered (attributed generically as "Verified AutoLenis buyer").
interface PublicTestimonial { id: string; rating: number; text: string }

async function getPublishedTestimonials(): Promise<PublicTestimonial[]> {
  try {
    return (await prisma.testimonial.findMany({
      where: { isApproved: true, isPublished: true },
      orderBy: { reviewedAt: "desc" },
      take: 24,
      select: { id: true, rating: true, text: true },
    })) as PublicTestimonial[];
  } catch {
    return [];
  }
}

const METRICS = [
  { value: `Up to ${MAX_DEALER_INVITATIONS}`, label: "Dealers competing per auction" },
  { value: `${AUCTION_DURATION_HOURS}h`, label: "Average auction window" },
  { value: `$${(DEPOSIT_AMOUNT_CENTS / 100).toFixed(0)}`, label: "Fully refundable deposit" },
  { value: "3 min", label: "Estimated prequalification time" },
];

export default async function TestimonialsPage() {
  const testimonials = await getPublishedTestimonials();

  return (
    <div className="bg-[#F8F9FB]">
      {/* Hero */}
      <section className="pt-16 py-24 md:py-32 text-center bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0B5FD1]">
            REAL STORIES
          </span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111827] mt-4 mb-5">
            Real Buyers. Real Outcomes.
          </h1>
          <p className="text-[#4B5563] text-lg max-w-2xl mx-auto leading-relaxed">
            AutoLenis is built on a simple premise: buyers deserve a better process. We publish
            verified buyer stories here as they come in.
          </p>
        </div>
      </section>

      {/* Buyer Testimonials — real, approved & published only */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-10">
            Buyer Experiences
          </h2>
          {testimonials.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="testimonials-grid">
              {testimonials.map((t) => (
                <div
                  key={t.id}
                  className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8"
                >
                  <Quote size={20} className="text-[#DBEAFE] mb-4" />
                  {t.rating > 0 && (
                    <div className="flex gap-0.5 mb-4" aria-label={`Rated ${t.rating} out of 5`}>
                      {Array.from({ length: Math.min(5, Math.max(0, t.rating)) }).map((_, i) => (
                        <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-[#4B5563] italic leading-relaxed mb-6">{t.text}</p>
                  <p className="font-bold text-[#111827] text-sm">— Verified AutoLenis buyer</p>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="bg-white border border-dashed border-[#CBD5E1] rounded-2xl p-10 text-center"
              data-testid="testimonials-empty"
            >
              <Quote size={22} className="text-[#CBD5E1] mx-auto mb-3" />
              <p className="text-sm text-[#4B5563] leading-relaxed max-w-md mx-auto">
                We&rsquo;re a young platform and are gathering verified buyer stories now. Approved
                reviews from real AutoLenis buyers will appear here — we don&rsquo;t publish anything
                we can&rsquo;t stand behind.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Aggregate Metrics — derived from platform configuration, not claims */}
      <section className="py-20 bg-[#F8F9FB]">
        <div className="mx-auto max-w-7xl px-6 md:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-12 text-center">
            How the Process Works
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {METRICS.map((m) => (
              <div
                key={m.label}
                className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-8 text-center"
              >
                <p className="text-3xl font-bold font-[family-name:var(--font-mono)] text-[#0B5FD1] mb-2">
                  {m.value}
                </p>
                <p className="text-xs text-[#4B5563]">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Leave a Review */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] mb-4">
            Had an AutoLenis Experience?
          </h2>
          <p className="text-[#4B5563] text-sm leading-relaxed mb-8">
            We&rsquo;re actively collecting buyer stories. If you&rsquo;ve used AutoLenis, we&rsquo;d
            love to hear about your experience.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 border border-[#DBEAFE] text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors"
          >
            Share Your Story <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-[#0B5FD1] text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
            Ready to Write Your Own Story?
          </h2>
          <p className="text-white/80 text-lg mb-8 leading-relaxed">
            Start with prequalification and let AutoLenis help you buy smarter.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-[#0B5FD1] font-semibold text-sm rounded-md hover:bg-[#EFF6FF] transition-colors shadow-md"
            >
              Get Prequalified <ArrowRight size={16} />
            </Link>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-2 px-8 py-4 border border-white/40 text-white font-semibold text-sm rounded-md hover:bg-white/10 transition-colors"
            >
              Browse Vehicles
            </Link>
          </div>
        </div>
      </section>

      {/* Faith Module */}
      <section className="py-16 bg-[#0B5FD1] border-t border-white/10 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <FaithVerseModule pageKey="testimonials" />
        </div>
      </section>
    </div>
  );
}

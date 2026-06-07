import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { prisma } from "@/lib/prisma";

// Phase C4 — surfaces published, city-level programmatic guides as crawlable
// internal links. Used two ways:
//   • Pillar pages link DOWN to the programmatic articles for their cluster
//     (bidirectional internal linking).
//   • The /buying-guide hub links OUT to recent guides regardless of cluster.
//
// Async server component: it owns its own DB read and renders nothing if there
// is no published content yet (e.g. before Phase C2 has generated articles, or
// at build time when the DB is unreachable), so it's safe to drop anywhere.

interface ProgrammaticGuideLinksProps {
  heading: string;
  /** Restrict to one cluster (pillar down-links). Omit for any cluster (hub). */
  cluster?: string;
  /** Don't surface this slug (e.g. the article you're already on). */
  excludeSlug?: string;
  limit?: number;
  testId?: string;
}

interface GuideRow {
  slug: string;
  title: string;
  h1: string;
  city: string;
  state: string;
}

async function loadGuides(
  cluster: string | undefined,
  excludeSlug: string | undefined,
  limit: number,
): Promise<GuideRow[]> {
  try {
    return await prisma.contentArticle.findMany({
      where: {
        status: "PUBLISHED",
        ...(cluster ? { cluster } : {}),
        ...(excludeSlug ? { slug: { not: excludeSlug } } : {}),
      },
      select: { slug: true, title: true, h1: true, city: true, state: true },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });
  } catch {
    return [];
  }
}

export default async function ProgrammaticGuideLinks({
  heading,
  cluster,
  excludeSlug,
  limit = 6,
  testId = "programmatic-guide-links",
}: ProgrammaticGuideLinksProps) {
  const guides = await loadGuides(cluster, excludeSlug, limit);
  if (guides.length === 0) return null;

  return (
    <section className="mt-16" data-testid={testId}>
      <h2 className="text-xl font-bold text-[#111827] tracking-tight mb-5">
        {heading}
      </h2>
      <ul className="grid sm:grid-cols-2 gap-4">
        {guides.map((g) => (
          <li key={g.slug}>
            <Link
              href={`/buying-guide/${g.slug}`}
              data-testid="programmatic-guide-link"
              className="block rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#0B5FD1] hover:shadow-sm transition-all"
            >
              {g.city && (
                <span className="text-[11px] tracking-wide uppercase font-semibold text-[#6B7280]">
                  {g.state ? `${g.city}, ${g.state}` : g.city}
                </span>
              )}
              <span className="mt-1 block text-sm font-semibold text-[#111827]">
                {g.title}
              </span>
              <span className="mt-2 flex items-center gap-1 text-xs text-[#0B5FD1]">
                Read guide <ArrowRight size={12} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

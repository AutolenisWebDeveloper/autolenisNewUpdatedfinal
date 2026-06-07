// Phase C3 — Single article review / detail page.
//
// Full preview of a generated ContentArticle plus the status controls used in
// the review workflow (DRAFT → REVIEW_NEEDED → PUBLISHED / ARCHIVED). Surfaces
// the quality score, the failed-check flags from the rubric, the SEO metadata,
// and the FAQ block so a reviewer can decide whether to publish.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getContentArticleById } from "@/lib/services/admin/admin-content.service";
import { clusterLabel, statusMeta } from "@/lib/content/cluster-meta";
import ArticleStatusActions from "@/components/admin/content/ArticleStatusActions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ParsedFaq {
  question: string;
  answer: string;
}

function parseFaqs(raw: string | null): ParsedFaq[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data.filter(
        (f): f is ParsedFaq =>
          f && typeof f.question === "string" && typeof f.answer === "string",
      );
    }
  } catch {
    /* ignore malformed JSON */
  }
  return [];
}

function parseFlags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data.filter((f): f is string => typeof f === "string");
  } catch {
    /* ignore */
  }
  return [];
}

export default async function AdminContentDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const article = await getContentArticleById(id);
  if (!article) notFound();

  const meta = statusMeta(article.status);
  const faqs = parseFaqs(article.faqJson);
  const flags = parseFlags(article.qualityFlags);

  const metaRows: Array<{ label: string; value: string }> = [
    { label: "Cluster", value: clusterLabel(article.cluster) },
    {
      label: "Vehicle",
      value: [article.make, article.model].filter(Boolean).join(" ") || "—",
    },
    { label: "Location", value: `${article.city}, ${article.state}` },
    { label: "Metro", value: article.metro ?? "—" },
    { label: "Wave", value: String(article.wave) },
    { label: "Target Keyword", value: article.targetKeyword },
    { label: "Author", value: article.authorSlug },
    {
      label: "Generated",
      value: article.generatedAt
        ? article.generatedAt.toLocaleString("en-US")
        : "Not generated",
    },
    { label: "Groq Model", value: article.groqModel ?? "—" },
    {
      label: "Search Grounded",
      value: article.searchGrounded === null ? "—" : article.searchGrounded ? "Yes" : "No",
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-content-detail-page">
      <Link
        href="/admin/content"
        className="inline-flex items-center gap-1.5 text-sm text-[#0B5FD1] hover:underline mb-4"
      >
        <ArrowLeft size={14} /> Back to Content Engine
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
        <h1 className="text-xl font-bold text-slate-900">{article.h1 || article.title}</h1>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        <span className="font-mono">{article.slug}</span>
        {article.status === "PUBLISHED" && (
          <>
            {" · "}
            <Link
              href={`/buying-guide/${article.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1 text-[#0B5FD1] hover:underline"
            >
              View live <ExternalLink size={12} />
            </Link>
          </>
        )}
      </p>

      {/* Status controls */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 mb-6" data-testid="content-detail-actions">
        <p className="text-sm font-semibold text-slate-800 mb-3">Status</p>
        <ArticleStatusActions articleId={article.id} status={article.status} />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Main content preview */}
        <div className="md:col-span-2 space-y-6">
          <section className="bg-white border border-[#E2E8F0] rounded-xl p-5" data-testid="content-detail-body">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">
              Article Body
            </p>
            <div
              className="content-article-preview text-sm text-slate-700 leading-relaxed [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_p]:mb-3 [&_a]:text-[#0B5FD1] [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1"
              dangerouslySetInnerHTML={{ __html: article.body }}
            />
          </section>

          {faqs.length > 0 && (
            <section className="bg-white border border-[#E2E8F0] rounded-xl p-5" data-testid="content-detail-faqs">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">
                FAQ ({faqs.length})
              </p>
              <div className="space-y-3">
                {faqs.map((f, i) => (
                  <div key={i}>
                    <p className="text-sm font-semibold text-slate-800">{f.question}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{f.answer}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar — metadata + quality */}
        <div className="space-y-6">
          <section className="bg-white border border-[#E2E8F0] rounded-xl p-5" data-testid="content-detail-quality">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">
              Quality
            </p>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-3xl font-bold text-[#0B5FD1]">
                {article.qualityScore ?? "—"}
              </span>
              <span className="text-sm text-slate-400">/ 6</span>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {article.wordCount ? `${article.wordCount.toLocaleString("en-US")} words` : "Word count unknown"}
            </p>
            {flags.length > 0 ? (
              <div data-testid="content-detail-flags">
                <p className="text-xs font-semibold text-amber-700 mb-1.5">
                  Failed checks ({flags.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {flags.map((flag) => (
                    <Badge key={flag} variant="amber" className="text-[11px]">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-green-700 font-medium">All rubric checks passed.</p>
            )}
          </section>

          <section className="bg-white border border-[#E2E8F0] rounded-xl p-5" data-testid="content-detail-meta">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">
              Metadata
            </p>
            <dl className="space-y-2">
              {metaRows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3 text-xs">
                  <dt className="text-slate-400 shrink-0">{row.label}</dt>
                  <dd className="text-slate-700 text-right break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="bg-white border border-[#E2E8F0] rounded-xl p-5" data-testid="content-detail-seo">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">
              SEO
            </p>
            <p className="text-xs text-slate-400">Title</p>
            <p className="text-sm text-slate-800 mb-2">{article.title}</p>
            <p className="text-xs text-slate-400">Meta Description</p>
            <p className="text-sm text-slate-600">{article.metaDescription}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

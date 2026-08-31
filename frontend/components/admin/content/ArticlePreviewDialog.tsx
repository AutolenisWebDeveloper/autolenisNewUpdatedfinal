"use client";

// Article preview — the read-before-you-publish panel on the Content worktable.
//
// Built on the kit's Radix dialog rather than the hand-rolled `fixed inset-0`
// aside it replaces. That is the whole accessibility fix: focus trap while
// open, focus RETURN to the row button on close, Escape, body scroll lock, and
// role="dialog" + aria-modal + aria-labelledby, none of which the previous
// drawer had. Composing the primitive is also the reason this file is short.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { sanitizeBody } from "@/lib/content/sanitize";
import {
  TONE_DOT,
  TONE_TEXT,
  parseFaqs,
  parseQualityFlags,
  qualityTone,
  statusMeta,
  wordCountTone,
} from "@/lib/content/cluster-meta";

export interface PreviewArticle {
  id: string;
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  body: string;
  faqJson: string | null;
  qualityFlags: string | null;
  qualityScore: number | null;
  wordCount: number | null;
  status: string;
}

const PROSE =
  "content-article-preview text-sm text-slate-700 leading-relaxed " +
  "[&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-5 [&_h2]:mb-2 " +
  "[&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_p]:mb-3 " +
  "[&_a]:text-al-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1";

interface Props {
  articleId: string | null;
  onClose: () => void;
  /** Row-level status change; resolves when the write completes. */
  onStatusChange: (id: string, status: "PUBLISHED" | "ARCHIVED") => Promise<void>;
  busy: boolean;
}

export default function ArticlePreviewDialog({ articleId, onClose, onStatusChange, busy }: Props) {
  const [article, setArticle] = useState<PreviewArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setArticle(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/content/${id}`);

      // Guard the response before parsing. A failed route can return an empty
      // body or an HTML error page; calling res.json() on either throws the
      // opaque "Unexpected end of JSON input". Read the raw text instead.
      const contentType = res.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");

      if (!res.ok || !isJson) {
        const raw = (await res.text()).trim();
        let message = `Preview failed (HTTP ${res.status})`;
        if (isJson && raw) {
          try {
            message = JSON.parse(raw)?.error?.message ?? message;
          } catch {
            /* fall through to the status-only message */
          }
        } else if (raw) {
          message = `${message}: ${raw.slice(0, 200)}`;
        }
        throw new Error(message);
      }

      const json = await res.json();
      const loaded = json?.data?.article as PreviewArticle | undefined;
      if (!loaded) throw new Error("Preview response was missing article data");
      setArticle(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load article");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (articleId) void load(articleId);
  }, [articleId, load]);

  const flags = parseQualityFlags(article?.qualityFlags);
  const faqs = parseFaqs(article?.faqJson);
  const meta = article ? statusMeta(article.status) : null;

  return (
    <Dialog open={articleId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        variant="sheet"
        side="right"
        className="flex w-full max-w-[640px] flex-col p-0"
        data-testid="preview-drawer"
      >
        <div className="border-b border-al-border px-6 py-4 pr-12">
          <DialogTitle className="text-sm font-bold text-slate-700">Article preview</DialogTitle>
          <DialogDescription className="sr-only">
            Full text, quality score and failed checks for the selected article.
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="py-20 text-center text-slate-400" data-testid="drawer-loading">
              <Loader2 size={22} className="inline animate-spin" aria-hidden />
              <span className="sr-only">Loading preview…</span>
            </p>
          ) : error ? (
            <div
              data-testid="drawer-error"
              role="alert"
              className="mt-6 rounded-al-md border border-red-200 bg-al-danger-subtle px-4 py-5 text-sm text-al-danger-fg"
            >
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={15} aria-hidden /> Couldn&rsquo;t load this preview
              </p>
              <p className="mt-2 break-words">{error}</p>
              <button
                type="button"
                onClick={() => articleId && load(articleId)}
                data-testid="drawer-retry"
                className="mt-4 inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold text-al-danger hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
              >
                Retry
              </button>
            </div>
          ) : article ? (
            <div data-testid="drawer-body">
              <div className="mb-2 flex items-center gap-2">
                {meta && <Badge variant={meta.variant}>{meta.label}</Badge>}
                {article.status === "PUBLISHED" && (
                  <Link
                    href={`/buying-guide/${article.slug}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs text-al-primary hover:underline"
                  >
                    View live <ExternalLink size={11} aria-hidden />
                  </Link>
                )}
              </div>

              <h2 className="mb-1.5 text-xl font-bold text-slate-900">{article.title}</h2>
              <p className="mb-3 text-sm text-slate-500">{article.metaDescription}</p>

              <div className="mb-4 flex items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${TONE_DOT[qualityTone(article.qualityScore)]}`}
                    aria-hidden
                  />
                  Quality {article.qualityScore ?? "—"}/6
                </span>
                <span className={TONE_TEXT[wordCountTone(article.wordCount)]}>
                  {article.wordCount
                    ? `${article.wordCount.toLocaleString("en-US")} words`
                    : "Word count unknown"}
                </span>
              </div>

              {flags.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5" data-testid="drawer-flags">
                  <span className="sr-only">{flags.length} failed rubric checks:</span>
                  {flags.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 rounded-full bg-al-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-al-warning-fg"
                    >
                      <AlertTriangle size={11} aria-hidden /> {f}
                    </span>
                  ))}
                </div>
              )}

              <div className={PROSE} dangerouslySetInnerHTML={{ __html: sanitizeBody(article.body) }} />

              {faqs.length > 0 && (
                <div className="mt-6 border-t border-al-border pt-5" data-testid="drawer-faqs">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
                    FAQ ({faqs.length})
                  </h3>
                  <dl className="space-y-3">
                    {faqs.map((f, i) => (
                      <div key={i}>
                        <dt className="text-sm font-semibold text-slate-800">{f.question}</dt>
                        <dd className="mt-0.5 text-sm text-slate-600">{f.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {article && (
          <div className="flex items-center gap-2 border-t border-al-border px-6 py-4">
            {article.status !== "PUBLISHED" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStatusChange(article.id, "PUBLISHED")}
                data-testid="drawer-publish"
                className="flex-1 rounded-al-md bg-al-success px-4 py-2 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
              >
                Publish this article
              </button>
            )}
            {article.status !== "ARCHIVED" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStatusChange(article.id, "ARCHIVED")}
                data-testid="drawer-retire"
                className="flex-1 rounded-al-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-al-danger hover:bg-al-danger-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
              >
                Archive this article
              </button>
            )}
            <Link
              href={`/admin/content/${article.id}`}
              data-testid="drawer-open-detail"
              className="rounded-al-md border border-al-border px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-al-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Open full review
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

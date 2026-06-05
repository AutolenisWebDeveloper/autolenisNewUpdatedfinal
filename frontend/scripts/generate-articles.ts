// Phase C2 — Article generation batch runner.
//
// Reads the Phase C1 keyword database, generates articles with the Groq engine,
// scores them against the quality rubric + compliance validator, and upserts the
// results into ContentArticle. Defaults to 25 articles per run (the spec's batch
// size) so a single invocation is cheap and reviewable.
//
// Requires GROQ_API_KEY and DATABASE_URL in the environment (.env is auto-loaded
// by Prisma when the client is constructed).
//
// Usage (from frontend/):
//   tsx scripts/generate-articles.ts                      # next 25 ungenerated
//   tsx scripts/generate-articles.ts --metro "Dallas-Fort Worth"
//   tsx scripts/generate-articles.ts --cluster dealer_quotes --limit 10
//   tsx scripts/generate-articles.ts --slug toyota-rav4-otd-price-dallas-tx
//   tsx scripts/generate-articles.ts --dry-run            # generate, no DB write
//   tsx scripts/generate-articles.ts --review-only        # never auto-publish
//   tsx scripts/generate-articles.ts --regenerate         # overwrite existing
//   tsx scripts/generate-articles.ts --concurrency 2

import { prisma } from "@/lib/prisma";
import {
  CONTENT_KEYWORDS,
  type ContentKeyword,
} from "@/lib/seo/content-keywords";
import { generateArticle, type GeneratedArticle } from "@/lib/content/generator";

interface CliOptions {
  limit: number;
  metro?: string;
  cluster?: string;
  wave?: number;
  slug?: string;
  dryRun: boolean;
  reviewOnly: boolean;
  regenerate: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    limit: 25,
    dryRun: false,
    reviewOnly: false,
    regenerate: false,
    concurrency: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--limit":
        opts.limit = Math.max(1, Number(next()) || 25);
        break;
      case "--metro":
        opts.metro = next();
        break;
      case "--cluster":
        opts.cluster = next();
        break;
      case "--wave":
        opts.wave = Number(next());
        break;
      case "--slug":
        opts.slug = next();
        break;
      case "--concurrency":
        opts.concurrency = Math.max(1, Number(next()) || 3);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--review-only":
        opts.reviewOnly = true;
        break;
      case "--regenerate":
        opts.regenerate = true;
        break;
      default:
        if (arg.startsWith("--")) {
          console.warn(`Unknown flag ignored: ${arg}`);
        }
    }
  }
  return opts;
}

function selectKeywords(opts: CliOptions): ContentKeyword[] {
  let pool = CONTENT_KEYWORDS;
  if (opts.slug) pool = pool.filter((k) => k.slug === opts.slug);
  if (opts.metro) pool = pool.filter((k) => k.metro === opts.metro);
  if (opts.cluster) pool = pool.filter((k) => k.cluster === opts.cluster);
  if (opts.wave !== undefined) pool = pool.filter((k) => k.wave === opts.wave);
  return pool;
}

// Skip keywords that already have an article unless --regenerate is set.
async function filterExisting(
  keywords: ContentKeyword[],
  regenerate: boolean,
): Promise<ContentKeyword[]> {
  if (regenerate) return keywords;
  const existing = await prisma.contentArticle.findMany({
    where: { slug: { in: keywords.map((k) => k.slug) } },
    select: { slug: true },
  });
  const have = new Set(existing.map((e) => e.slug));
  return keywords.filter((k) => !have.has(k.slug));
}

async function persist(article: GeneratedArticle): Promise<void> {
  const k = article.keyword;
  const publishedAt = article.status === "PUBLISHED" ? new Date() : null;
  const data = {
    cluster: k.cluster,
    make: k.make ?? null,
    model: k.model ?? null,
    city: k.city,
    state: k.state,
    metro: k.metro,
    wave: k.wave,
    targetKeyword: k.targetKeyword,
    title: k.title,
    metaDescription: k.metaDescription,
    h1: k.h1,
    body: article.body,
    faqJson: article.faqJson,
    wordCount: article.wordCount,
    authorSlug: "markist",
    status: article.status,
    qualityScore: article.quality.score,
    qualityFlags: article.qualityFlags,
    generatedAt: new Date(),
    groqModel: article.model,
    searchGrounded: false,
    publishedAt,
  };
  await prisma.contentArticle.upsert({
    where: { slug: k.slug },
    create: { slug: k.slug, ...data },
    update: data,
  });
}

// Run an async worker over items with a fixed concurrency.
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log("Phase C2 — Article Generation Engine");
  console.log(
    `Options: ${JSON.stringify({ ...opts }, null, 0)}\n`,
  );

  const selected = selectKeywords(opts);
  if (selected.length === 0) {
    console.error("No keywords match the given filters. Nothing to do.");
    process.exitCode = 1;
    return;
  }

  const pending = (await filterExisting(selected, opts.regenerate)).slice(0, opts.limit);
  if (pending.length === 0) {
    console.log("All matching keywords already have articles. Use --regenerate to overwrite.");
    return;
  }

  console.log(`Generating ${pending.length} article(s) (concurrency ${opts.concurrency})...\n`);

  const results: GeneratedArticle[] = [];
  const failures: Array<{ slug: string; error: string }> = [];

  await runPool(pending, opts.concurrency, async (keyword, index) => {
    const tag = `[${index + 1}/${pending.length}] ${keyword.slug}`;
    try {
      const article = await generateArticle(keyword, { reviewOnly: opts.reviewOnly });
      if (!opts.dryRun) await persist(article);
      results.push(article);
      console.log(
        `${tag} → ${article.status} (quality ${article.quality.score}/6, ${article.wordCount}w, ` +
          `compliance ${article.compliance.passed ? "ok" : "FLAGGED"}, ${article.model})`,
      );
    } catch (err) {
      failures.push({ slug: keyword.slug, error: String(err) });
      console.error(`${tag} → FAILED: ${String(err)}`);
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  const byStatus = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\n──────────── Summary ────────────");
  console.log(`Generated: ${results.length}   Failed: ${failures.length}`);
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
  if (opts.dryRun) console.log("DRY RUN — nothing was written to the database.");
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.slug}: ${f.error}`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// AMIPS Phase 3 — Search Intelligence pipeline.
//
// Closes the AMIPS feedback loop by pulling real Google Search Console
// performance for every published /intelligence/* page into the
// `search_intelligence` database, and mirroring impressions/clicks back onto
// the originating AmipsPage. Once enough weeks accumulate, the content queue
// re-prioritizes from real search demand instead of population estimates.
//
// Auth is intentionally dependency-free: we sign a service-account JWT with the
// already-present `jose` library and exchange it for an access token, then call
// the Search Console REST API with plain fetch (same posture as the Census
// pipeline). No googleapis SDK, no extra cost.
//
// GOOGLE_SEARCH_CONSOLE_KEY is a base64-encoded Google service-account JSON
// (the same file you download from the GCP console). The service account must
// be added as a user on the Search Console property. If the key is absent the
// pipeline no-ops with a warning so builds and local runs never block on it.

import { SignJWT, importPKCS8 } from "jose";
import { prisma } from "@/lib/prisma";

export interface SearchSyncResult {
  synced: number;
}

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const INTELLIGENCE_PATH = "/intelligence/";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface GscRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

// Decode the base64 service-account JSON from the environment. Returns null
// (with a warning) when the key is missing or malformed so callers can no-op.
function loadServiceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SEARCH_CONSOLE_KEY;
  if (!raw) {
    console.warn("[amips-p3-search] GOOGLE_SEARCH_CONSOLE_KEY not set; skipping sync");
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as ServiceAccountKey;
    if (!json.client_email || !json.private_key) {
      console.warn("[amips-p3-search] service-account key missing client_email/private_key");
      return null;
    }
    return json;
  } catch (err) {
    console.warn("[amips-p3-search] could not parse GOOGLE_SEARCH_CONSOLE_KEY", err);
    return null;
  }
}

// Mint a short-lived OAuth access token via the JWT-bearer grant. The private
// key is a PKCS8 PEM (as shipped in the service-account JSON).
async function getAccessToken(sa: ServiceAccountKey): Promise<string | null> {
  try {
    const key = await importPKCS8(sa.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: GSC_SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience(GSC_TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);

    const res = await fetch(GSC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[amips-p3-search] token exchange failed: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch (err) {
    console.warn("[amips-p3-search] token exchange error", err);
    return null;
  }
}

// YYYY-MM-DD in UTC.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The slug is the final path segment of an /intelligence/<slug> URL.
export function slugFromUrl(url: string): string | null {
  const idx = url.indexOf(INTELLIGENCE_PATH);
  if (idx === -1) return null;
  const rest = url.slice(idx + INTELLIGENCE_PATH.length);
  const slug = rest.split(/[?#/]/)[0]?.trim();
  return slug ? decodeURIComponent(slug) : null;
}

/**
 * Pull one week of Search Console performance for every /intelligence/* URL on
 * `siteUrl` and upsert it into search_intelligence, mirroring impressions and
 * clicks onto the matching AmipsPage. `weekOf` is the Monday of the target week;
 * the query window is that Monday through the following Sunday (inclusive).
 */
export async function syncSearchIntelligence(
  siteUrl: string,
  weekOf: Date,
): Promise<SearchSyncResult> {
  console.log(`[amips-p3-search] starting sync for ${siteUrl}, week of ${isoDate(weekOf)}`);

  const sa = loadServiceAccount();
  if (!sa) return { synced: 0 };

  const token = await getAccessToken(sa);
  if (!token) return { synced: 0 };

  const startDate = isoDate(weekOf);
  const end = new Date(weekOf);
  end.setUTCDate(end.getUTCDate() + 6);
  const endDate = isoDate(end);

  let rows: GscRow[] = [];
  try {
    const res = await fetch(
      `${GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["page"],
          rowLimit: 25_000,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      console.warn(`[amips-p3-search] search analytics query failed: ${res.status}`);
      return { synced: 0 };
    }
    const body = (await res.json()) as { rows?: GscRow[] };
    rows = body.rows ?? [];
  } catch (err) {
    console.warn("[amips-p3-search] search analytics fetch error", err);
    return { synced: 0 };
  }

  // Keep only /intelligence/* rows and resolve each to its AmipsPage by slug.
  const candidates = rows.flatMap((r) => {
    const url = r.keys?.[0];
    if (!url || !url.includes(INTELLIGENCE_PATH)) return [];
    const slug = slugFromUrl(url);
    if (!slug) return [];
    return [{ url, slug, row: r }];
  });

  if (candidates.length === 0) {
    console.log("[amips-p3-search] no /intelligence/* rows returned");
    return { synced: 0 };
  }

  const pages = await prisma.amipsPage.findMany({
    where: { slug: { in: candidates.map((c) => c.slug) } },
    select: { id: true, slug: true, contentTier: true, leadsGenerated: true },
  });
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]));

  let synced = 0;
  for (const c of candidates) {
    const page = pageBySlug.get(c.slug);
    if (!page) continue; // GSC knows the URL but we have no page record yet.

    const impressions = Math.round(c.row.impressions ?? 0);
    const clicks = Math.round(c.row.clicks ?? 0);
    const ctr = c.row.ctr ?? (impressions > 0 ? clicks / impressions : null);
    const avgPosition = c.row.position ?? null;
    const leads = page.leadsGenerated;
    const conversionRate = clicks > 0 ? leads / clicks : null;

    try {
      await prisma.searchIntelligence.upsert({
        where: { url_weekOf: { url: c.url, weekOf } },
        create: {
          url: c.url,
          contentTier: page.contentTier,
          searchImpressions: impressions,
          clicks,
          ctr,
          avgPosition,
          indexedStatus: impressions > 0,
          leadsGenerated: leads,
          conversionRate,
          weekOf,
        },
        update: {
          contentTier: page.contentTier,
          searchImpressions: impressions,
          clicks,
          ctr,
          avgPosition,
          indexedStatus: impressions > 0,
          leadsGenerated: leads,
          conversionRate,
        },
      });

      // Mirror the latest week's totals onto the page for fast dashboard reads
      // and the queue re-prioritizer.
      await prisma.amipsPage.update({
        where: { id: page.id },
        data: { impressions, clicks },
      });
      synced++;
    } catch (err) {
      console.error(`[amips-p3-search] error syncing ${c.url}`, err);
    }
  }

  console.log(`[amips-p3-search] done — synced ${synced}/${candidates.length} pages`);
  return { synced };
}

// The Monday (UTC) of the week containing `d`. Cron callers normalize to this so
// search_intelligence rows align to clean ISO weeks.
export function mondayOf(d: Date): Date {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = m.getUTCDay(); // 0 Sun … 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  m.setUTCDate(m.getUTCDate() - diff);
  return m;
}

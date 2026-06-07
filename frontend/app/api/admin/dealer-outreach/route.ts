// GET /api/admin/dealer-outreach — list dealer recruitment prospects.
// Supports rich filtering, full-text-ish search, sorting, and pagination so the
// enhanced pipeline UI can drive server-side queries.
//
// Query params:
//   q          text search across name, city, email, contactName
//   state      2-letter state code (exact)
//   city       partial match
//   zip        zip code (exact)
//   brand      brand/franchise (exact)
//   status     DealerProspectStatus enum value
//   buyerOppId legacy filter (kept for back-compat)
//   hasEmail   "true" | "false"
//   hasWebsite "true" | "false"
//   sort       newest | oldest | name_asc | name_desc | last_contacted | state_asc
//   page       integer, default 1
//   limit      integer, default 50, max 200
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { DealerProspectStatus, type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<string>(Object.values(DealerProspectStatus));

type SortKey =
  | "newest"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "last_contacted"
  | "state_asc";

function orderByForSort(
  sort: SortKey,
): Prisma.DealerProspectOrderByWithRelationInput {
  switch (sort) {
    case "oldest":
      return { createdAt: "asc" };
    case "name_asc":
      return { name: "asc" };
    case "name_desc":
      return { name: "desc" };
    case "last_contacted":
      return { contactedAt: { sort: "desc", nulls: "last" } };
    case "state_asc":
      return { state: { sort: "asc", nulls: "last" } };
    case "newest":
    default:
      return { createdAt: "desc" };
  }
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const state = searchParams.get("state")?.trim();
  const city = searchParams.get("city")?.trim();
  const zip = searchParams.get("zip")?.trim();
  const brand = searchParams.get("brand")?.trim();
  const status = searchParams.get("status");
  const buyerOppId = searchParams.get("buyerOppId");
  const hasEmail = searchParams.get("hasEmail");
  const hasWebsite = searchParams.get("hasWebsite");
  const sortParam = (searchParams.get("sort") ?? "newest") as SortKey;

  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50;
  const limit = Math.min(200, Math.max(1, rawLimit));

  const where: Prisma.DealerProspectWhereInput = {};

  if (status && VALID_STATUSES.has(status)) {
    where.status = status as DealerProspectStatus;
  }
  if (buyerOppId) {
    where.buyerOppId = buyerOppId;
  }
  if (state) {
    where.state = state;
  }
  if (city) {
    where.city = { contains: city, mode: "insensitive" };
  }
  if (zip) {
    where.zip = zip;
  }
  if (brand) {
    where.brand = brand;
  }
  if (hasEmail === "true") where.email = { not: null };
  if (hasEmail === "false") where.email = null;
  if (hasWebsite === "true") where.website = { not: null };
  if (hasWebsite === "false") where.website = null;

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
    ];
  }

  try {
    const [total, prospects] = await Promise.all([
      prisma.dealerProspect.count({ where }),
      prisma.dealerProspect.findMany({
        where,
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          phone: true,
          email: true,
          website: true,
          brand: true,
          status: true,
          contactName: true,
          contactTitle: true,
          emailSource: true,
          emailEnrichedAt: true,
          contactedAt: true,
          repliedAt: true,
          onboardedAt: true,
          deadAt: true,
          deadReason: true,
          replyDetectedAt: true,
          sequencePausedAt: true,
          createdAt: true,
          updatedAt: true,
          founderNotes: true,
          outreachLog: {
            orderBy: { sentAt: "desc" },
            take: 1,
          },
          _count: { select: { outreachLog: true } },
        },
        orderBy: orderByForSort(sortParam),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return adminSuccess({
      prospects,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch (err) {
    return adminError(
      "FETCH_FAILED",
      err instanceof Error ? err.message : "Failed to fetch prospects",
      500,
    );
  }
}

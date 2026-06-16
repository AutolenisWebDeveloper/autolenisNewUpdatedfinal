import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { MAX_SAVED_SEARCHES } from "@/lib/constants";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1), filters: z.record(z.unknown()) });

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const searches = await prisma.savedSearch.findMany({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" } });
  return successResponse({ searches });
}

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid input", 400);

  const count = await prisma.savedSearch.count({ where: { buyerId: buyer.id } });
  if (count >= MAX_SAVED_SEARCHES) return errorResponse("LIMIT_REACHED", `Max ${MAX_SAVED_SEARCHES} saved searches`, 400);

  const search = await prisma.savedSearch.create({ data: { buyerId: buyer.id, name: parsed.data.name, filters: parsed.data.filters as object } });

  // CRM contact-plane sync (additive, non-blocking) — append AFTER the saved
  // search is committed so a CRM hiccup can never affect the create. The form
  // collects NO email/SMS consent, so we pass none (consent merges upward in the
  // upsert and is never defaulted true). ZIP/state ride the event payload to feed
  // the downstream SMS recipient-timezone resolver.
  try {
    const email = buyer.user?.email ?? null;
    if (email) {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const { emitDomainEvent } = await import("@/lib/events/emit");
      const supabase = getServiceSupabase();

      const contact = await ContactService.upsertContact(supabase, {
        email,
        phone: buyer.phone ?? null,
        firstName: buyer.firstName ?? undefined,
        lastName: buyer.lastName ?? undefined,
        source: "saved_search",
      });
      await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyer.id);

      await emitDomainEvent("saved_search_created", {
        domainEntityId: search.id,
        supabase,
        contact: {
          email,
          phone: buyer.phone ?? null,
          firstName: buyer.firstName ?? undefined,
          lastName: buyer.lastName ?? undefined,
          source: "saved_search",
        },
        data: {
          saved_search_id: search.id,
          buyer_id: buyer.id,
          name: search.name,
          zip: buyer.zip ?? null,
          state: buyer.state ?? null,
        },
      });
    }
  } catch (err) {
    logger.error("[saved-search] CRM emit failed:", err);
  }

  return successResponse({ search }, 201);
}

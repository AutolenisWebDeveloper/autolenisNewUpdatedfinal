// lib/services/trade-in/trade-in.service.ts — System 18

import { prisma } from "@/lib/prisma";
import { TradeInStatus, TradeInCondition } from "@prisma/client";

export async function submitTradeIn(buyerId: string, data: {
  vin?: string; year: number; make: string; model: string; trim?: string;
  mileage?: number; condition: string; loanStatus?: string; loanBalanceCents?: number; notes?: string;
}) {
  const submission = await prisma.tradeInSubmission.create({
    data: {
      buyerId,
      vin: data.vin,
      year: data.year,
      make: data.make,
      model: data.model,
      trim: data.trim,
      mileage: data.mileage,
      condition: data.condition as TradeInCondition,
      loanStatus: data.loanStatus,
      loanBalanceCents: data.loanBalanceCents,
      notes: data.notes,
      status: TradeInStatus.SUBMITTED,
    },
  });

  // CRM contact-plane sync (additive, non-blocking) — append AFTER the trade-in
  // row is committed so a CRM hiccup can never affect the submission. The form
  // collects NO email/SMS consent, so we pass none (consent merges upward in the
  // upsert and is never defaulted true). ZIP/state ride the event payload to feed
  // the downstream SMS recipient-timezone resolver.
  try {
    const buyer = await prisma.buyer.findUnique({
      where: { id: buyerId },
      include: { user: true },
    });
    const email = buyer?.user.email ?? null;
    if (buyer && email) {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const { emitDomainEvent } = await import("@/lib/events/emit");
      const supabase = getServiceSupabase();

      const contact = await ContactService.upsertContact(supabase, {
        email,
        phone: buyer.phone ?? null,
        firstName: buyer.firstName ?? undefined,
        lastName: buyer.lastName ?? undefined,
        source: "trade_in",
      });
      await ContactService.linkContactIdentity(supabase, contact.id, "buyer", buyer.id);

      await emitDomainEvent("trade_in_submitted", {
        domainEntityId: submission.id,
        supabase,
        contact: {
          email,
          phone: buyer.phone ?? null,
          firstName: buyer.firstName ?? undefined,
          lastName: buyer.lastName ?? undefined,
          source: "trade_in",
        },
        data: {
          trade_in_id: submission.id,
          buyer_id: buyer.id,
          year: submission.year,
          make: submission.make,
          model: submission.model,
          zip: buyer.zip ?? null,
          state: buyer.state ?? null,
        },
      });
    }
  } catch (err) {
    console.error("[trade-in] CRM emit failed:", err);
  }

  return submission;
}

export async function getBuyerTradeIns(buyerId: string) {
  return prisma.tradeInSubmission.findMany({ where: { buyerId }, orderBy: { createdAt: "desc" } });
}

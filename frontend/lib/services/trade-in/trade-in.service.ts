// lib/services/trade-in/trade-in.service.ts — System 18

import { prisma } from "@/lib/prisma";
import { TradeInStatus, TradeInCondition } from "@prisma/client";

export async function submitTradeIn(buyerId: string, data: {
  vin?: string; year: number; make: string; model: string; trim?: string;
  mileage?: number; condition: string; loanStatus?: string; loanBalanceCents?: number; notes?: string;
}) {
  return prisma.tradeInSubmission.create({
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
}

export async function getBuyerTradeIns(buyerId: string) {
  return prisma.tradeInSubmission.findMany({ where: { buyerId }, orderBy: { createdAt: "desc" } });
}

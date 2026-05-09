// lib/services/offer/junk-fee.service.ts
import { prisma } from "@/lib/prisma";

const BUILT_IN_JUNK = ["nitrogen", "nitro tire", "vin etch", "paint protection", "ppf", "dealer prep", "advertising", "market adjustment"];

export async function detectJunkFees(feeItems: Array<{name: string; amount: number}>): Promise<Array<{name: string; amount: number; isJunk: boolean}>> {
  const dbPatterns = await prisma.junkFeePattern.findMany({ where: { isActive: true } });
  const allKeywords = [...BUILT_IN_JUNK, ...dbPatterns.flatMap(p => p.keywords)];
  return feeItems.map(fee => ({
    ...fee,
    isJunk: allKeywords.some(kw => fee.name.toLowerCase().includes(kw.toLowerCase())),
  }));
}

export async function getTotalJunkFees(feeItems: Array<{name: string; amount: number}>): Promise<number> {
  const tagged = await detectJunkFees(feeItems);
  return tagged.filter(f => f.isJunk).reduce((s, f) => s + f.amount, 0);
}

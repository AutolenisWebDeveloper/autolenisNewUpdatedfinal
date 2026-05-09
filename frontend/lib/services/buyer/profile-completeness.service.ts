// lib/services/buyer/profile-completeness.service.ts — F21

import { prisma } from "@/lib/prisma";

export async function computeProfileCompleteness(buyerId: string): Promise<{ score: number; missing: string[] }> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { preQualification: true, user: true },
  });
  if (!buyer) return { score: 0, missing: ["Account not found"] };

  const checks = [
    { label: "Email verified", done: !!buyer.user.email },
    { label: "First and last name", done: !!buyer.firstName && !!buyer.lastName },
    { label: "Phone number", done: !!buyer.phone },
    { label: "Street address", done: !!buyer.address },
    { label: "City and ZIP", done: !!buyer.city && !!buyer.zip },
    { label: "Onboarding complete", done: buyer.onboardingComplete },
    { label: "Pre-qualification", done: !!buyer.preQualification },
    { label: "Terms accepted", done: !!buyer.termsAcceptedAt },
  ];

  const done = checks.filter(c => c.done).length;
  const score = Math.round((done / checks.length) * 100);
  const missing = checks.filter(c => !c.done).map(c => c.label);

  return { score, missing };
}

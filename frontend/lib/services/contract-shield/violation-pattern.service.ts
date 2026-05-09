// lib/services/contract-shield/violation-pattern.service.ts
// System 8 ENH — tracks repeat junk fee and violation patterns per dealer
// When the same violation type appears repeatedly, creates a ViolationPatternRecord
// Surfaced in dealer scorecard and contract shield admin view

import { prisma } from "@/lib/prisma";

// Threshold: 3+ occurrences of same violation → PATTERN_VIOLATION flag
const PATTERN_THRESHOLD = 3;

export interface ViolationSummary {
  dealerId: string;
  patterns: Array<{
    ruleId: string;
    ruleName: string;
    count: number;
    flagged: boolean;
    firstSeen: Date;
    lastSeen: Date;
  }>;
  totalPatternViolations: number;
}

// Process contract scan results for violation patterns
// Called after every contract scan on a dealer's contract
export async function trackViolationPattern(
  dealerId: string,
  scanFixList: Array<{ foundValue: string; howToFix: string; ruleId?: string }>
): Promise<void> {
  if (!scanFixList.length) return;

  const rules = await prisma.contractScanRule.findMany({ where: { isActive: true } });
  const ruleMap = new Map(rules.map(r => [r.id, r.name]));

  for (const fix of scanFixList) {
    // Map fix to rule (use ruleId if present, else match by keyword)
    const ruleId = fix.ruleId ?? matchRuleByKeyword(fix.howToFix, rules);
    if (!ruleId) continue;

    // Upsert ViolationPatternRecord — count how many times this dealer has had this violation
    const existing = await prisma.violationPatternRecord.findUnique({
      where: { dealerId_ruleId: { dealerId, ruleId } },
    });

    if (existing) {
      const newCount = existing.count + 1;
      const shouldFlag = newCount >= PATTERN_THRESHOLD;

      await prisma.violationPatternRecord.update({
        where: { dealerId_ruleId: { dealerId, ruleId } },
        data: {
          count: newCount,
          flagged: shouldFlag,
        },
      });

      // If newly hitting the threshold — create admin alert
      if (!existing.flagged && shouldFlag) {
        const ruleName = ruleMap.get(ruleId) ?? ruleId;
        await prisma.notification.create({
          data: {
            title: `Pattern Violation: ${ruleName}`,
            body: `Dealer has violated "${ruleName}" ${newCount} times. Pattern flag triggered.`,
            type: "SYSTEM_ALERT",
          },
        }).catch(() => {});
      }
    } else {
      await prisma.violationPatternRecord.create({
        data: {
          dealerId,
          ruleId,
          count: 1,
          flagged: false,
        },
      });
    }
  }
}

// Get violation pattern summary for a dealer (used in scorecard)
export async function getDealerViolationSummary(dealerId: string): Promise<ViolationSummary> {
  const records = await prisma.violationPatternRecord.findMany({
    where: { dealerId },
    orderBy: { count: "desc" },
  });

  const rules = await prisma.contractScanRule.findMany({ where: { isActive: true } });
  const ruleMap = new Map(rules.map(r => [r.id, r.name]));

  const patterns = records.map(r => ({
    ruleId: r.ruleId,
    ruleName: ruleMap.get(r.ruleId) ?? r.ruleId,
    count: r.count,
    flagged: r.flagged,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
  }));

  return {
    dealerId,
    patterns,
    totalPatternViolations: records.filter(r => r.flagged).length,
  };
}

// Compute junk fee ratio from violation records (for dealer scorecard)
export async function computeJunkFeeRatio(dealerId: string): Promise<number> {
  const totalScans = await prisma.contractScan.count({
    where: { deal: { offer: { dealerId } } },
  });
  if (totalScans === 0) return 0;

  const junkFeePatterns = await prisma.violationPatternRecord.count({
    where: {
      dealerId,
      count: { gte: 1 },
    },
  });

  return Math.min(100, Math.round((junkFeePatterns / totalScans) * 100));
}

// Keyword-based rule matching fallback
function matchRuleByKeyword(text: string, rules: Array<{ id: string; name: string; ruleType: string }>): string | null {
  const lower = text.toLowerCase();
  for (const rule of rules) {
    if (lower.includes(rule.name.toLowerCase()) || lower.includes(rule.ruleType.toLowerCase().replace(/_/g, " "))) {
      return rule.id;
    }
  }
  return null;
}

// lib/services/contract-shield/contract-shield.service.ts
// System 8 — Contract Shield scan pipeline
// Integrates with violation-pattern.service for repeat tracking

import { prisma } from "@/lib/prisma";
import { getContractShieldResult } from "@/lib/constants";
import { trackViolationPattern } from "./violation-pattern.service";
import {
  sendContractShieldAlertEmail,
  sendContractApprovedEmail,
} from "@/lib/services/email/resend.service";

interface FixItem {
  foundValue: string;
  expectedValue: string;
  howToFix: string;
  ruleId?: string;
  item?: string;
  amount?: string;
  reason?: string;
}

// Built-in junk-fee detection rules (always run, regardless of DB rules).
// Keep these focused on patterns that are commonly considered junk fees by
// consumer protection bureaus.
const DOC_FEE_CAP_CENTS = 15_000; // $150
const ADDON_PACKING_CAP_CENTS = 30_000; // $300
const DOC_FEE_PATTERNS = [
  /(?:documentation|doc)\s*(?:fee|charge)[^$\d]*\$?\s*(\d{1,5})(?:\.\d{0,2})?/gi,
];
const ADDON_PATTERNS: { keyword: string; label: string }[] = [
  { keyword: "etch warranty", label: "Etch warranty" },
  { keyword: "vin etch", label: "VIN etch" },
  { keyword: "paint protection", label: "Paint protection" },
  { keyword: "fabric protection", label: "Fabric protection" },
  { keyword: "interior protection", label: "Interior protection" },
  { keyword: "mandatory warranty", label: "Mandatory warranty" },
  { keyword: "mandatory protection", label: "Mandatory protection" },
  { keyword: "mandatory etch", label: "Mandatory etch" },
];

function findAmountNearKeyword(text: string, keyword: string): number | null {
  // Look for $NNN AFTER the keyword (within ~60 chars). Searching only forward
  // avoids picking up an unrelated dollar amount that appeared earlier in the
  // contract (e.g. another fee on the same line).
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx < 0) return null;
  const start = idx + keyword.length;
  const window = text.slice(start, Math.min(text.length, start + 60));
  const match = window.match(/\$?\s*(\d{2,5})(?:\.\d{0,2})?/);
  if (!match) return null;
  return parseInt(match[1], 10) * 100;
}

function runBuiltinHeuristics(contractText: string): { score: number; fixList: FixItem[] } {
  let score = 100;
  const fixList: FixItem[] = [];

  // Documentation fee cap
  for (const pattern of DOC_FEE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(contractText)) !== null) {
      const cents = parseInt(m[1], 10) * 100;
      if (cents > DOC_FEE_CAP_CENTS) {
        score -= 20;
        fixList.push({
          item: "Documentation fee",
          amount: `$${cents / 100}`,
          reason: `Documentation fee exceeds the $${DOC_FEE_CAP_CENTS / 100} consumer-protection threshold.`,
          howToFix: `Negotiate the documentation fee down to $${DOC_FEE_CAP_CENTS / 100} or less, or have the dealer remove it.`,
          foundValue: `$${cents / 100}`,
          expectedValue: `≤ $${DOC_FEE_CAP_CENTS / 100}`,
          ruleId: "BUILTIN_DOC_FEE_CAP",
        });
      }
    }
  }

  // Mandatory add-on / payment-packing detection
  for (const { keyword, label } of ADDON_PATTERNS) {
    const cents = findAmountNearKeyword(contractText, keyword);
    if (cents !== null && cents > ADDON_PACKING_CAP_CENTS) {
      score -= 18;
      fixList.push({
        item: label,
        amount: `$${cents / 100}`,
        reason: `${label} above $${ADDON_PACKING_CAP_CENTS / 100} is a known payment-packing pattern.`,
        howToFix: `Decline the ${label.toLowerCase()} add-on or require the dealer to remove the mandatory bundle.`,
        foundValue: `${label}: $${cents / 100}`,
        expectedValue: `Optional or ≤ $${ADDON_PACKING_CAP_CENTS / 100}`,
        ruleId: "BUILTIN_ADDON_PACKING",
      });
    } else if (cents === null && contractText.toLowerCase().includes(keyword.toLowerCase())) {
      // Keyword present but no amount found — still flag as suspicious
      score -= 8;
      fixList.push({
        item: label,
        amount: "unspecified",
        reason: `${label} clause detected without a clear price disclosure.`,
        howToFix: `Ask the dealer to itemize the ${label.toLowerCase()} cost or remove the clause.`,
        foundValue: keyword,
        expectedValue: "Itemized & optional",
        ruleId: "BUILTIN_ADDON_DISCLOSURE",
      });
    }
  }

  return { score, fixList };
}

export async function scanContract(dealId: string, contractText: string, dealerId: string): Promise<{
  score: number;
  status: string;
  fixList: FixItem[];
}> {
  const rules = await prisma.contractScanRule.findMany({ where: { isActive: true } });

  // Start with built-in heuristics so common junk-fee patterns are always flagged
  const builtin = runBuiltinHeuristics(contractText);
  let score = builtin.score;
  const fixList: FixItem[] = [...builtin.fixList];

  const lowerText = contractText.toLowerCase();
  const seenBuiltinDocFee = fixList.some((f) => f.ruleId === "BUILTIN_DOC_FEE_CAP");

  for (const rule of rules) {
    const config = rule.config as Record<string, unknown>;

    if (rule.ruleType === "JUNK_FEE_KEYWORD") {
      const keywords = (config.keywords as string[]) ?? [];
      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          const deduction = rule.severity === "HIGH" ? 20 : rule.severity === "MEDIUM" ? 10 : 5;
          score -= deduction;
          fixList.push({
            foundValue: kw,
            expectedValue: "Not present",
            howToFix: `Remove "${kw}" charge — this is a flagged junk fee per AutoLenis Contract Shield rules.`,
            ruleId: rule.id,
          });
        }
      }
    }

    // Skip DB FEE_CAP if built-in already flagged this contract's doc fee
    if (rule.ruleType === "FEE_CAP" && config.maxCents && !seenBuiltinDocFee) {
      const maxCents = config.maxCents as number;
      const match = contractText.match(/documentation fee[^\d]*\$?(\d+)/i);
      if (match) {
        const found = parseInt(match[1]) * 100;
        if (found > maxCents) {
          score -= 20;
          fixList.push({
            foundValue: `$${found / 100}`,
            expectedValue: `≤ $${maxCents / 100}`,
            howToFix: `Documentation fee must not exceed $${maxCents / 100}. Reduce or remove this fee.`,
            ruleId: rule.id,
          });
        }
      }
    }
  }

  score = Math.max(0, score);
  const status = getContractShieldResult(score);

  // Save scan result
  const existingScans = await prisma.contractScan.findMany({ where: { dealId }, orderBy: { version: "desc" }, take: 1 });
  const version = (existingScans[0]?.version ?? 0) + 1;

  await prisma.contractScan.create({
    data: { dealId, score, status, fixList: fixList as object[], version, scannedAt: new Date() },
  });

  await prisma.deal.update({
    where: { id: dealId },
    data: { contractShieldScore: score, contractShieldStatus: status },
  });

  // Track violation patterns for dealer
  if (fixList.length > 0) {
    await trackViolationPattern(dealerId, fixList).catch(() => {});
  }

  // Notify buyer via email based on scan result
  notifyBuyerContractScan(dealId, status, fixList.length).catch(() => {});

  return { score, status, fixList };
}

async function notifyBuyerContractScan(
  dealId: string,
  status: string,
  issueCount: number,
): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: {
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!deal?.buyer?.user?.email) return;
  const email = deal.buyer.user.email;
  const firstName = deal.buyer.firstName;

  if (status === "PASS") {
    await sendContractApprovedEmail({ to: email, firstName, dealId });
  } else if (status === "FAIL" || status === "WARNING") {
    await sendContractShieldAlertEmail({ to: email, firstName, dealId, issueCount });
  }
}

export async function overrideContractShield(dealId: string, _adminId: string, _reason: string): Promise<void> {
  const existingScans = await prisma.contractScan.findMany({ where: { dealId }, orderBy: { version: "desc" }, take: 1 });
  const version = (existingScans[0]?.version ?? 0) + 1;

  await prisma.contractScan.create({
    data: { dealId, score: 100, status: "PASS", fixList: [], version, scannedAt: new Date() },
  });

  await prisma.deal.update({
    where: { id: dealId },
    data: { contractShieldScore: 100, contractShieldStatus: "PASS" },
  });
}

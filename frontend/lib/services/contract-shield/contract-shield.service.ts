// lib/services/contract-shield/contract-shield.service.ts
// System 8 — Contract Shield scan pipeline
// Integrates with violation-pattern.service for repeat tracking

import { prisma } from "@/lib/prisma";
import { DealStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getContractShieldResult } from "@/lib/constants";
import { trackViolationPattern } from "./violation-pattern.service";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { NoSignableDocumentError } from "@/lib/services/esign/buyer-signing.service";
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

/**
 * Run the Contract Shield rules over a contract's text and persist the verdict.
 *
 * `contractVersionId` records WHICH document this verdict judged — the link the
 * admin approval gate binds to. The only caller (scanContractVersion) always
 * supplies it; the parameter is optional purely so the column stays nullable for
 * rows written before it existed. Omitting it produces an UN-APPROVABLE scan
 * (the gate hard-refuses a null link) rather than one that approves the wrong
 * document, which is the fail-closed direction.
 */
export async function scanContract(dealId: string, contractText: string, dealerId: string, contractVersionId?: string): Promise<{
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

    // Skip DB FEE_CAP if built-in already flagged this contract's doc fee.
    //
    // `config.threshold` IS READ HERE AND IT IS A BUG FIX, NOT A WIDENING. The scanner read
    // only `config.maxCents`, while the admin create/PATCH routes write `config.threshold`
    // — so NO FEE_CAP rule created through the admin UI could ever fire. The rule appeared
    // in the list, reported itself active, and did nothing. Both keys are accepted so
    // existing rows keep working and new ones start working.
    const feeCapCents = (config.maxCents ?? config.threshold) as number | undefined;
    if (rule.ruleType === "FEE_CAP" && feeCapCents && !seenBuiltinDocFee) {
      const maxCents = feeCapCents;
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

    // ── THE FOUR THAT WERE LISTED AND NEVER EVALUATED ─────────────────────────
    // `APR_VALIDATION`, `PAYMENT_PACKING`, `DISCLOSURE_CHECK` and `FINANCE_MARKUP` have
    // existed in `ContractScanRuleType` and been offered by the admin rules UI since the
    // enum was written. Nothing evaluated them. A rule row of one of those types was
    // loaded, iterated, matched neither branch above, and was silently ignored — no log,
    // no error, no effect on the score. An administrator configuring "APR rates exceeding
    // 29% are flagged as suspicious" got a row in a table and nothing else.

    // APR_VALIDATION — an APR above the configured ceiling.
    if (rule.ruleType === "APR_VALIDATION") {
      const maxApr = (config.maxApr ?? config.threshold) as number | undefined;
      const aprMatch = contractText.match(
        /(?:a\.?p\.?r\.?|annual\s*percentage\s*rate)[^\d%]{0,40}(\d{1,2}(?:\.\d{1,4})?)\s*%?/i,
      );
      // A threshold stored in basis points (2900) and one stored as a percentage (29) are
      // both in production-shaped seed data, so normalise rather than pick one and be
      // wrong half the time.
      const ceiling = maxApr == null ? null : maxApr > 100 ? maxApr / 100 : maxApr;
      if (ceiling != null && aprMatch) {
        const apr = parseFloat(aprMatch[1]);
        if (Number.isFinite(apr) && apr > ceiling) {
          score -= rule.severity === "HIGH" ? 20 : rule.severity === "MEDIUM" ? 10 : 5;
          fixList.push({
            foundValue: `${apr}% APR`,
            expectedValue: `≤ ${ceiling}% APR`,
            howToFix:
              `The contract's annual percentage rate exceeds the ${ceiling}% threshold AutoLenis flags for review. ` +
              "Confirm the rate with the lender, or document why it is correct.",
            ruleId: rule.id,
          });
        }
      }
    }

    // PAYMENT_PACKING — a monthly payment presented without the total it belongs to.
    // §14b names payment packing; the practice is quoting a payment that hides what is
    // being financed. The factual test is presence: a contract that states a monthly
    // payment must also state the amount financed and the total of payments.
    if (rule.ruleType === "PAYMENT_PACKING") {
      const hasMonthly = /monthly\s*payment|payment\s*of\s*\$|per\s*month/i.test(contractText);
      const hasAmountFinanced = /amount\s*financed/i.test(contractText);
      const hasTotalOfPayments = /total\s*of\s*payments|total\s*sale\s*price/i.test(contractText);
      if (hasMonthly && (!hasAmountFinanced || !hasTotalOfPayments)) {
        const missing = [
          !hasAmountFinanced ? "amount financed" : null,
          !hasTotalOfPayments ? "total of payments" : null,
        ].filter(Boolean).join(" and ");
        score -= rule.severity === "HIGH" ? 20 : rule.severity === "MEDIUM" ? 10 : 5;
        fixList.push({
          foundValue: `a monthly payment is stated without the ${missing}`,
          expectedValue: "monthly payment shown alongside the amount financed and the total of payments",
          howToFix:
            `State the ${missing} on the contract beside the monthly payment. A payment quoted on its own ` +
            "does not let the buyer see what they are actually paying.",
          ruleId: rule.id,
        });
      }
    }

    // DISCLOSURE_CHECK — a required term that must be PRESENT. This is the inverse of the
    // keyword rules above, which flag presence; getting that backwards would flag every
    // compliant contract and pass every non-compliant one.
    if (rule.ruleType === "DISCLOSURE_CHECK") {
      const required = (config.requiredTerms as string[]) ?? [];
      // A disclosure is only owed when the thing it discloses is actually in the contract.
      // Demanding a GAP disclosure on a contract with no GAP product would be noise.
      const anchor = (config.whenPresent as string | undefined) ?? required[0];
      const anchored = !anchor || lowerText.includes(anchor.toLowerCase());
      if (anchored && required.length > 0) {
        const missing = required.filter((term) => !lowerText.includes(term.toLowerCase()));
        if (missing.length === required.length && required.length > 0) {
          score -= rule.severity === "HIGH" ? 20 : rule.severity === "MEDIUM" ? 10 : 5;
          fixList.push({
            foundValue: `none of: ${required.join(", ")}`,
            expectedValue: `the contract discloses ${required.join(" or ")}`,
            howToFix:
              `${rule.name} requires this to be disclosed and itemised on the contract. Add the disclosure.`,
            ruleId: rule.id,
          });
        }
      }
    }

    // FINANCE_MARKUP — the dealer reserve: the spread between the lender's buy rate and
    // the rate the buyer is charged. Evaluated ONLY when the contract states both, which
    // most do not; a contract that states neither is not evidence of no markup, so it
    // produces nothing rather than a false clear.
    if (rule.ruleType === "FINANCE_MARKUP") {
      const maxBps = (config.maxMarkupBps ?? config.threshold) as number | undefined;
      const buy = contractText.match(/buy\s*rate[^\d%]{0,40}(\d{1,2}(?:\.\d{1,4})?)/i);
      const sell = contractText.match(
        /(?:contract\s*rate|a\.?p\.?r\.?|annual\s*percentage\s*rate)[^\d%]{0,40}(\d{1,2}(?:\.\d{1,4})?)/i,
      );
      if (maxBps != null && buy && sell) {
        const markupBps = Math.round((parseFloat(sell[1]) - parseFloat(buy[1])) * 100);
        if (markupBps > maxBps) {
          score -= rule.severity === "HIGH" ? 20 : rule.severity === "MEDIUM" ? 10 : 5;
          fixList.push({
            foundValue: `${(markupBps / 100).toFixed(2)}% over the buy rate`,
            expectedValue: `≤ ${(maxBps / 100).toFixed(2)}% over the buy rate`,
            howToFix:
              "The dealer reserve on this contract exceeds the configured ceiling. Reduce the contract rate " +
              "or document the lender's own pricing.",
            ruleId: rule.id,
          });
        }
      }
    }
  }

  // ── §14b's FACTUAL COMPARISON — the thing Contract Shield is actually for ──
  // Everything above judges the contract on its own. This judges it against what was
  // AGREED: the winning offer, the dealership's reaffirmation and the recap both parties
  // confirmed — including EACH accepted optional product individually.
  //
  // It is weighted heavily and deliberately. A junk-fee keyword is a warning about a
  // practice; a contract whose out-the-door total is $600 higher than the recap the buyer
  // confirmed is a different document from the one they agreed to, and §14b says the
  // response is to HOLD it: "Any unexplained increase, any addition, any inconsistent
  // total, a changed VIN, a changed financing term, or a changed trade figure is held for
  // correction or documented review."
  //
  // Never throws onward: a comparison that fails is itself a finding (fail-closed), never
  // a silent pass. The scan must produce a verdict even when a record is unreadable.
  try {
    const { compareContractAgainstAgreedTerms } = await import("@/lib/services/contract/contract-comparison.service");
    const discrepancies = await compareContractAgainstAgreedTerms({ dealId, contractText });
    for (const d of discrepancies) {
      // A changed VIN or a product that first appears in the contract is disqualifying on
      // its own — 40 points takes any contract below the FAIL threshold from a perfect
      // score, so one of these can never be outvoted by an otherwise clean document.
      const severe = d.key === "vin" || d.kind === "ADDITION";
      score -= severe ? 40 : 15;
      fixList.push({
        foundValue: d.foundValue,
        expectedValue: d.expectedValue,
        howToFix: d.howToFix,
        ruleId: `COMPARISON_${d.key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
        item: d.label,
        reason: `${d.kind} against the ${d.source}`,
      });
    }
  } catch (err) {
    logger.error("[contract-shield] agreed-terms comparison failed — holding the contract", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    score -= 40;
    fixList.push({
      foundValue: "the comparison against the agreed terms could not be completed",
      expectedValue: "the contract compared against the offer, reaffirmation and confirmed recap",
      howToFix:
        "Operations must re-run the scan. A contract that could not be compared is HELD, never approved — " +
        "the same rule §14b applies to extraction failure.",
      ruleId: "COMPARISON_UNAVAILABLE",
    });
  }

  score = Math.max(0, score);
  const status = getContractShieldResult(score);

  // Save scan result
  const existingScans = await prisma.contractScan.findMany({ where: { dealId }, orderBy: { version: "desc" }, take: 1 });
  const version = (existingScans[0]?.version ?? 0) + 1;

  await prisma.contractScan.create({
    data: { dealId, score, status, fixList: fixList as object[], version, scannedAt: new Date(), contractVersionId: contractVersionId ?? null },
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

  // G2 — on a high-confidence PASS, auto-advance the deal to CONTRACT_APPROVED
  // through the guarded seam and prepare the in-house signing envelope, removing the manual
  // admin approve click. WARNING/FAIL still hold for human review. Self-contained
  // and idempotent — it never breaks the scan result.
  await autoAdvanceContractOnPass(dealId, status);

  return { score, status, fixList };
}

/**
 * Pure decision core for Contract Shield auto-advance. Given the deal's current
 * status and the scan classification, return the ordered legal transitions to
 * apply and whether to prepare the in-house signing envelope.
 *
 * - Only a PASS advances anything (WARNING/FAIL hold for human review).
 * - The deal is walked forward only from the contract-review states along the
 *   legal path (CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED).
 * - A deal already at/after CONTRACT_APPROVED is a no-op (idempotent re-scan),
 *   and a deal not yet in the contract stage is never force-jumped.
 */
export function planContractAutoAdvance(
  current: DealStatus,
  scanStatus: string,
): { transitions: DealStatus[]; fireEnvelope: boolean } {
  if (scanStatus !== "PASS") return { transitions: [], fireEnvelope: false };
  if (current === DealStatus.CONTRACT_PENDING) {
    return { transitions: [DealStatus.CONTRACT_REVIEW, DealStatus.CONTRACT_APPROVED], fireEnvelope: true };
  }
  if (current === DealStatus.CONTRACT_REVIEW) {
    return { transitions: [DealStatus.CONTRACT_APPROVED], fireEnvelope: true };
  }
  return { transitions: [], fireEnvelope: false };
}

/**
 * Impure auto-approval seam: on PASS, walk the deal to CONTRACT_APPROVED through
 * the guarded (non-forced) `advanceDealStatus` seam, prepare the in-house signing
 * envelope once (dealId-unique upsert makes `prepareBuyerSigningEnvelope` safe
 * under re-scan), and
 * create the caller-owned buyer/dealer CONTRACT_APPROVED in-app notifications
 * (the comms orchestrator treats CONTRACT_APPROVED as caller-owned, so this seam
 * must write them). Self-contained: swallows its own errors so a notification or
 * envelope failure never corrupts the scan.
 */
export async function autoAdvanceContractOnPass(dealId: string, scanStatus: string): Promise<void> {
  try {
    if (scanStatus !== "PASS") return;

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        buyer: { include: { user: { select: { email: true } } } },
        offer: { include: { dealer: { include: { user: { select: { email: true } } } } } },
      },
    });
    if (!deal) return;

    const plan = planContractAutoAdvance(deal.status, scanStatus);
    if (plan.transitions.length === 0) return;

    for (const to of plan.transitions) {
      await advanceDealStatus(dealId, to, {
        actorRole: "SYSTEM",
        reason: "Contract Shield auto-approval (PASS ≥ 85)",
      });
    }

    if (plan.fireEnvelope) {
      const buyerEmail = deal.buyer?.user?.email ?? undefined;
      const buyerName =
        `${deal.buyer?.firstName ?? ""} ${deal.buyer?.lastName ?? ""}`.trim() || undefined;
      // Best-effort pre-warm of the in-house signing envelope (bound to the
      // approved contract by hash; safe under re-scan via the dealId-unique
      // upsert). This runs before the ContractVersion row is flipped to APPROVED,
      // so a NoSignableDocumentError here is EXPECTED and benign — the envelope is
      // prepared for real when the buyer opens /buyer/esign (or an admin sends it).
      // §13-D30: EVERY required signer, not just the buyer.
      const { openSigningForRequiredSigners } = await import("@/lib/services/esign/open-signing.service");
      await openSigningForRequiredSigners({ dealId, buyerName, buyerEmail }).catch((err) => {
        if (err instanceof NoSignableDocumentError) {
          logger.info(`[contract-shield] signing deferred to buyer-initiated prep for deal ${dealId}`);
        } else {
          logger.error("[contract-shield] auto open signing failed:", err);
        }
      });

      await createContractApprovedNotifications(dealId, deal.buyerId, deal.offer?.dealer?.id ?? null);
    }
  } catch (err) {
    logger.error("[contract-shield] autoAdvanceContractOnPass failed:", err);
  }
}

/**
 * Caller-owned CONTRACT_APPROVED in-app notifications (buyer + dealer), deduped
 * on a stable metadata key so a retried/re-scanned approval cannot double-notify.
 */
async function createContractApprovedNotifications(
  dealId: string,
  buyerId: string,
  dealerId: string | null,
): Promise<void> {
  const buyerKey = `contract-approved:${dealId}`;
  try {
    const existing = await prisma.notification.findFirst({
      where: { buyerId, metadata: { path: ["key"], equals: buyerKey } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.notification.create({
        data: {
          buyerId,
          type: "CONTRACT_APPROVED",
          title: "Contract approved",
          body: "Your purchase agreement passed review. Your signing link is ready.",
          actionUrl: `/buyer/esign`,
          metadata: { key: buyerKey },
        },
      });
    }
  } catch (err) {
    logger.error("[contract-shield] buyer approved notification failed:", err);
  }

  if (!dealerId) return;
  const dealerKey = `contract-approved-dealer:${dealId}`;
  try {
    const existing = await prisma.notification.findFirst({
      where: { dealerId, metadata: { path: ["key"], equals: dealerKey } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.notification.create({
        data: {
          dealerId,
          type: "CONTRACT_APPROVED",
          channel: "IN_APP",
          title: "Contract approved",
          body: `Your agreement for Deal ${dealId.slice(0, 8)} was approved by AutoLenis and sent to the buyer for signing.`,
          metadata: { key: dealerKey },
        },
      });
    }
  } catch (err) {
    logger.error("[contract-shield] dealer approved notification failed:", err);
  }
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

// NOTE: the standalone `overrideContractShield()` helper was removed in Program 4.
// It wrote a synthetic PASS scan and mutated the Deal WITHOUT an audit-log entry
// and WITHOUT routing through the guarded state machine — an unaudited override
// footgun that had zero callers. The ONLY sanctioned Contract Shield override is
// the admin route POST /api/admin/contract-shield/[reviewId], which is
// role-gated (SUPER_ADMIN / OPERATIONS_ADMIN) and writes an AdminAuditLog entry.

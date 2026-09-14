// lib/services/deal/deal-recap.service.ts
// §Stage 11 — the final deal recap.
//
// "One consolidated recap is presented to both buyer and dealership — the platform equivalent of
// the worksheet a desk manager and a customer agree on before paperwork."
//
// THREE RULES THIS FILE EXISTS TO ENFORCE, none of them cosmetic:
//
// 1. §11a — "Every warranty, service contract, GAP product, maintenance plan, protection package,
//    or other dealer product is separately named, separately priced, and separately accepted or
//    declined by the buyer at this stage. An optional product may never first appear in the
//    contract." The recap is therefore the ONLY place an optional product can enter the deal, and
//    `optionalProducts` below is the list Contract Shield compares the contract against in Phase 8.
//    A product with `accepted: null` is undecided, not declined — the buyer confirms nothing until
//    every one of them has an explicit answer.
//
// 2. §Stage 11 — "Any later change produces a revised recap, disclosed and audited — settled
//    figures are never silently rewritten." Versions are append-only: a dispute supersedes the old
//    row rather than editing it, and `superseded_by` is the chain. `version` is unique per deal
//    because the row's PRIMARY KEY is DERIVED from `(deal_id, version)` — see `recapId` below.
//    Reading the current max inside the transaction would NOT have been enough under Read
//    Committed, and an earlier draft of this file said it was.
//
// 3. §11b — "No funds pass from the buyer to the dealership before the contract is executed."
//    Nothing in this file moves money, and nothing in it can: there is no payment rail here, and
//    the parity row that pins that (`deal-early/C6`) is a guard test rather than a code path.
//
// THE FREEZE. "Repeated failure escalates to Operations with the Deal frozen at recap." N = 2
// disputes — owner-ruled at STOP 1 — so the THIRD dispute freezes. `FROZEN_PENDING_RELEASE` is not
// used: that status is Phase 10's coordinated unwind of an EXECUTED contract, and a deal stuck at
// recap has no contract. The freeze here is the deal staying at RECAP_PENDING with an Operations
// row that names it, which is what "frozen at recap" says.

import { prisma } from "@/lib/prisma";
import { DealStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import { advanceDealStatus } from "./deal.service";
import { enqueueOrRaise, cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_7_TEMPLATES, recapCancelKey } from "@/lib/services/comms/state-recheck-registry";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { renderRecapReady } from "@/lib/services/comms/phase7-email-content";

type Db = typeof prisma | Prisma.TransactionClient;

/** §Stage 11's "repeated failure". Owner-ruled at STOP 1: the third dispute freezes. */
export const RECAP_DISPUTE_THRESHOLD = 2;

/**
 * A DETERMINISTIC id for one (deal, version), so the PRIMARY KEY is the concurrency control.
 *
 * FOUND BY REVIEWING THIS FILE AS THOUGH SOMEONE ELSE HAD WRITTEN IT. `buildRecap` read
 * `currentRecap` and then created — a check-then-act with nothing between the two, under Read
 * Committed. Two concurrent arrivals could both see "no recap" and both insert a version 1, and
 * `deal_recaps` carries no unique on `(deal_id, version)`. `currentRecap` would then return one of
 * the two arbitrarily, so the buyer could confirm one row and the dealership the other and NEITHER
 * would ever reach both-confirmed: a deal stuck at RECAP_PENDING with two complete recaps and no
 * way to tell which is real.
 *
 * Reachable in practice, not just in theory: `buildRecap` runs from the arrival hook AND from the
 * buyer's GET as a repair for a failed hook, so two page loads are enough.
 *
 * A unique index on `(deal_id, version)` would also fix it, but it NARROWS a constraint on a table
 * with an existing writer, which is Core Rule 11 territory and a migration. The primary key is
 * already unique and already enforced by the database; deriving the id from the identity of the row
 * makes a duplicate insert collide on it. The loser catches P2002 and re-reads the winner's row,
 * which is the right answer rather than an error.
 */
/**
 * One Serializable transaction, retried once on a serialization failure (P2034). The retry exists
 * because Serializable's whole contract is "one of the conflicting transactions is aborted" — a
 * caller that does not retry converts correctness into a 500 the user sees.
 */
async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      const retryable =
        err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2037");
      if (!retryable || attempt === 1) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * An empty JSON array is indistinguishable from "the dealership did not tell us", and treating it
 * as "there are none" silently deletes the offer's fees, add-ons and incentives from the recap.
 * Null unless there is something in it.
 */
function nonEmpty(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return null;
  return value ?? null;
}

export function recapId(dealId: string, version: number): string {
  const digest = createHash("sha256").update(`deal_recap:${dealId}:v${version}`).digest("hex");
  // UUID-shaped so the column keeps the format every other id in this schema uses.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

export class RecapError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RecapError";
  }
}

/** One itemised line of the out-the-door total. §Stage 11's seven named components. */
export interface RecapLine {
  key: string;
  label: string;
  amountCents: number;
}

/** §11a — separately named, separately priced, separately accepted or declined. */
export interface OptionalProduct {
  key: string;
  label: string;
  amountCents: number;
  /** null means UNDECIDED. The buyer cannot confirm the recap while any remains null. */
  accepted: boolean | null;
}

export interface RecapItemised {
  vehiclePriceCents: number;
  discountsAndIncentivesCents: number;
  documentationFeeCents: number;
  taxesCents: number;
  titleAndRegistrationCents: number;
  addOnsCents: number;
  deliveryFeeCents: number;
  otdCents: number;
  lines: RecapLine[];
}

export interface RecapView {
  id: string;
  version: number;
  itemised: RecapItemised | null;
  optionalProducts: OptionalProduct[];
  preliminaryAllowanceCents: number | null;
  payoffGoodThroughDate: Date | null;
  /** §Stage 11 — "Net trade equity or negative equity, stated plainly". Negative means owed. */
  equityCents: number | null;
  negativeEquityRolledIn: boolean;
  downPaymentCents: number | null;
  financingPath: string | null;
  amountFinancedCents: number | null;
  estimatedPaymentCents: number | null;
  delivery: Prisma.JsonValue | null;
  plan: string | null;
  buyerConfirmedAt: Date | null;
  dealerConfirmedAt: Date | null;
  supersededBy: string | null;
  disputeReason: string | null;
  createdAt: Date;
}

/**
 * Build and persist recap version 1 from the confirmed reaffirmation and the deal's lineage.
 *
 * Called on arrival at RECAP_PENDING. Idempotent: a deal that already has a live recap returns it
 * rather than opening a second version, because a second version with no dispute behind it would
 * break the "any later change produces a revised recap" chain at its first link.
 */
export async function buildRecap(params: { dealId: string; now?: Date }): Promise<RecapView> {
  const now = params.now ?? new Date();

  const live = await currentRecap(params.dealId);
  if (live) return live;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      buyerId: true,
      downPaymentCents: true,
      financingPath: true,
      otdCentsConfirmed: true,
      currentPlanSnapshot: { select: { plan: true } },
      offer: {
        select: {
          otdPriceCents: true,
          vehiclePriceCents: true,
          taxCents: true,
          docFeeCents: true,
          titleRegistrationCents: true,
          deliveryFeeCents: true,
          deliveryTerms: true,
          addOnItems: true,
          incentiveItems: true,
          junkFeeItems: true,
          aprRate: true,
          termMonths: true,
        },
      },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          preliminaryAllowanceCents: true,
          verifiedPayoffCents: true,
          payoffGoodThroughDate: true,
          loanBalanceCents: true,
        },
      },
    },
  });
  if (!deal?.offer) throw new RecapError("NOT_FOUND", "This deal has no offer to build a recap from.");

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId: params.dealId, status: "CONFIRMED" },
    orderBy: { createdAt: "desc" },
  });

  // The CONFIRMED figures win over the offer's where they exist: §Stage 11's recap is of the deal
  // as the dealership reaffirmed it, which is the whole point of Stage 10 coming first.
  const otdCents = reaffirmation?.confirmedOtdCents ?? deal.otdCentsConfirmed ?? deal.offer.otdPriceCents;
  // `??` FALLS BACK ON null, NOT ON `[]`, and that distinction ate the itemisation.
  //
  // The dealer form submitted `confirmedFeeItems: []` unconditionally, so every reaffirmation row
  // carried three empty arrays, so every recap showed `addOnsCents: 0` and no fee lines while
  // `otdCents` still contained them — an itemisation that does not reconcile with its own total.
  // Worse for §11a: `optionalProducts` derives from `addOnItems`, so a $1,200 GAP product on the
  // offer produced an EMPTY product list, `allProductsDecided` returned true vacuously, and the
  // product first appeared in the contract — the one thing §11a forbids.
  //
  // The form now submits the offer's items (pre-filled, editable), and this is the second half of
  // the fix: an empty list means the dealership confirmed nothing about the line items, which is
  // the offer's own list, not an empty deal.
  const feeItems = jsonItems(nonEmpty(reaffirmation?.confirmedFeeItems) ?? deal.offer.junkFeeItems);
  const addOnItems = jsonItems(nonEmpty(reaffirmation?.confirmedAddOnItems) ?? deal.offer.addOnItems);
  const incentiveItems = jsonItems(nonEmpty(reaffirmation?.confirmedIncentiveItems) ?? deal.offer.incentiveItems);

  const addOnsCents = addOnItems.reduce((s, i) => s + i.amountCents, 0);
  const incentivesCents = incentiveItems.reduce((s, i) => s + i.amountCents, 0);
  const docFeeCents = deal.offer.docFeeCents ?? 0;
  const titleCents = deal.offer.titleRegistrationCents ?? 0;
  const deliveryCents = deal.offer.deliveryFeeCents ?? 0;

  const itemised: RecapItemised = {
    vehiclePriceCents: deal.offer.vehiclePriceCents,
    discountsAndIncentivesCents: incentivesCents,
    documentationFeeCents: docFeeCents,
    taxesCents: deal.offer.taxCents,
    titleAndRegistrationCents: titleCents,
    addOnsCents,
    deliveryFeeCents: deliveryCents,
    otdCents,
    lines: [
      { key: "vehicle", label: "Vehicle price", amountCents: deal.offer.vehiclePriceCents },
      { key: "incentives", label: "Discounts and incentives", amountCents: -incentivesCents },
      { key: "docFee", label: "Documentation fee", amountCents: docFeeCents },
      { key: "taxes", label: "Taxes", amountCents: deal.offer.taxCents },
      { key: "titleReg", label: "Title and registration", amountCents: titleCents },
      ...feeItems.map((f, i) => ({ key: `fee-${i}`, label: f.label, amountCents: f.amountCents })),
      { key: "addOns", label: "Optional products", amountCents: addOnsCents },
      { key: "delivery", label: "Delivery fee", amountCents: deliveryCents },
    ],
  };
  itemised.lines = reconcileLines(itemised.lines, otdCents);

  // §11a — every add-on becomes an optional product awaiting an explicit answer. `accepted: null`
  // is the state that blocks confirmation, so a product the dealership listed cannot ride into the
  // contract on the buyer's silence.
  const optionalProducts: OptionalProduct[] = addOnItems.map((a, i) => ({
    key: `product-${i}`,
    label: a.label,
    amountCents: a.amountCents,
    accepted: null,
  }));

  const trade = deal.tradeInSubmissions[0] ?? null;
  // §Stage 11 — "Net trade equity or negative equity, stated plainly". Allowance less payoff.
  // Payoff prefers the VERIFIED figure; the buyer's own stated loan balance is the fallback and is
  // not presented as verified anywhere.
  const payoffCents = trade?.verifiedPayoffCents ?? trade?.loanBalanceCents ?? null;
  const equityCents =
    trade?.preliminaryAllowanceCents != null && payoffCents != null
      ? trade.preliminaryAllowanceCents - payoffCents
      : trade?.preliminaryAllowanceCents ?? null;

  const downPaymentCents = deal.downPaymentCents ?? 0;
  const amountFinancedCents = amountFinanced({
    otdCents,
    downPaymentCents,
    equityCents,
    financingPath: deal.financingPath,
  });

  const id = recapId(params.dealId, 1);
  try {
    await prisma.dealRecap.create({
      data: {
        id,
        dealId: params.dealId,
        version: 1,
        itemized: itemised as unknown as Prisma.InputJsonValue,
        optionalProducts: optionalProducts as unknown as Prisma.InputJsonValue,
        preliminaryAllowanceCents: trade?.preliminaryAllowanceCents ?? null,
        payoffGoodThroughDate: trade?.payoffGoodThroughDate ?? null,
        equityCents,
        downPaymentCents,
        financingPath: deal.financingPath,
        amountFinancedCents,
        estimatedPaymentCents: estimateMonthlyPaymentCents(
          amountFinancedCents,
          deal.offer!.aprRate,
          deal.offer!.termMonths,
        ),
        delivery: (deal.offer!.deliveryTerms
          ? { terms: deal.offer!.deliveryTerms }
          : Prisma.JsonNull) as Prisma.InputJsonValue,
        plan: deal.currentPlanSnapshot?.plan ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    // P2002 on the primary key: a concurrent caller built the same version first. That is the
    // expected outcome of a race, not an error — return their row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await currentRecap(params.dealId);
      if (winner) return winner;
    }
    throw err;
  }

  await notifyRecapReady(params.dealId, 1, otdCents, false);
  const built = await currentRecap(params.dealId);
  if (!built) throw new RecapError("BUILD_FAILED", "The recap was written but could not be read back.");
  return built;
}

/**
 * §Stage 11 — "the complete out-the-door figure ITEMISED". An itemisation that does not add up to
 * the total it sits under is not an itemisation; it is a list beside a number.
 *
 * NOTHING MADE THEM ADD UP. The lines come from two sources — the offer's stored components
 * (vehicle price, tax, documentation, title and registration, delivery) and the dealership's
 * confirmed fee, add-on and incentive lists — while `otdCents` is the authoritative figure the
 * dealership reaffirmed. They can legitimately differ: a dealership may raise or lower the
 * out-the-door price without restating the components, or add a $2,000 fee and absorb it rather
 * than pass it on. In both cases a buyer reading the table found it did not sum to the number they
 * were being asked to agree.
 *
 * THE FIX IS TO SHOW THE REMAINDER, NOT TO REFUSE THE FIGURE. An earlier attempt refused the
 * dealership's submission when the two disagreed, which was the wrong layer and the wrong answer:
 * it blocked every legitimate price change, because a price change moves the total without moving
 * any of the three item lists. The total is authoritative — §10a compares it, the ceiling test
 * reads it, the buyer pays it — so the itemisation reconciles TO it, and the residual is named
 * rather than hidden.
 *
 * Both directions are named honestly:
 *   • the total exceeds the lines → "Other charges included in the total" (the buyer is paying
 *     something the components do not enumerate, and they can now see that they are);
 *   • the lines exceed the total → "Dealer contribution" (the dealership is absorbing the
 *     difference, which is true and is in the buyer's favour).
 */
export function reconcileLines(lines: RecapLine[], otdCents: number): RecapLine[] {
  const sum = lines.reduce((total, line) => total + line.amountCents, 0);
  const residual = otdCents - sum;
  // A dollar of rounding is not a line item. Below that the table reads as adding up, and a
  // "$0.40 other charges" row would be noise a buyer has to decide whether to worry about.
  if (Math.abs(residual) < 100) return lines;
  return [
    ...lines,
    residual > 0
      ? { key: "residual", label: "Other charges included in the total", amountCents: residual }
      : { key: "residual", label: "Dealer contribution", amountCents: residual },
  ];
}

/**
 * §Stage 11's amount financed — "Amount financed, if applicable", and it has to agree with the
 * line above it that says whether negative equity is being rolled in.
 *
 * NEGATIVE EQUITY IS FINANCED, NOT DISCARDED, and this computation used to discard it. It read
 * `- Math.max(0, equityCents ?? 0)`, which floors negative equity at zero. A buyer $5,000
 * upside-down on their trade saw the amount financed calculated as though the shortfall did not
 * exist — while `negativeEquityRolledIn`, derived from the same `equityCents`, was TRUE and the
 * recap page told them in plain words: "That amount is being added to what you finance, so you
 * will be borrowing it." Two statements about the same money, contradicting each other on the one
 * screen §Stage 11 requires to reconcile, with the estimated monthly payment computed from the
 * smaller figure — roughly $99/month low on a 60-month term at 7%.
 *
 * Subtracting the SIGNED value is the whole fix: positive equity reduces the principal, negative
 * equity increases it, which is what "rolled in" means. Exported because it is the arithmetic a
 * buyer is asked to agree to, and arithmetic that is only reachable through a database write is
 * arithmetic nobody tests.
 */
export function amountFinanced(input: {
  otdCents: number;
  downPaymentCents: number;
  equityCents: number | null;
  financingPath: string | null;
}): number {
  if (input.financingPath === "CASH") return 0;
  return Math.max(0, input.otdCents - input.downPaymentCents - (input.equityCents ?? 0));
}

/**
 * §Stage 11's amortisation, stated rather than hidden: the same standard formula the buyer's own
 * financing surfaces use, on the amount actually financed. Returns null rather than a fabricated
 * figure when the terms are not known — §8.1f's lesson from the Best Price Report's "~$450/mo"
 * with no recorded term is that an invented number is worse than an absent one.
 */
export function estimateMonthlyPaymentCents(
  principalCents: number,
  aprRate: number | null,
  termMonths: number | null,
): number | null {
  if (!termMonths || termMonths <= 0) return null;
  if (principalCents <= 0) return 0;
  if (aprRate == null) return null;
  const monthlyRate = aprRate / 100 / 12;
  if (monthlyRate === 0) return Math.round(principalCents / termMonths);
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return Math.round((principalCents * monthlyRate * factor) / (factor - 1));
}

interface Item {
  label: string;
  amountCents: number;
}

/** Same defensive read as the reaffirmation's: three historical line-item shapes exist. */
function jsonItems(value: Prisma.JsonValue | null | undefined): Item[] {
  if (!Array.isArray(value)) return [];
  const out: Item[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label : typeof o.name === "string" ? o.name : null;
    if (!label) continue;
    const cents =
      typeof o.amountCents === "number"
        ? o.amountCents
        : typeof o.amount === "number"
          ? Math.round(o.amount * 100)
          : 0;
    out.push({ label, amountCents: cents });
  }
  return out;
}

/** The live (non-superseded) recap for a deal, or null. */
export async function currentRecap(dealId: string, db: Db = prisma): Promise<RecapView | null> {
  const row = await db.dealRecap.findFirst({
    where: { dealId, supersededBy: null },
    orderBy: { version: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    itemised: (row.itemized as unknown as RecapItemised) ?? null,
    optionalProducts: Array.isArray(row.optionalProducts)
      ? (row.optionalProducts as unknown as OptionalProduct[])
      : [],
    preliminaryAllowanceCents: row.preliminaryAllowanceCents,
    payoffGoodThroughDate: row.payoffGoodThroughDate,
    equityCents: row.equityCents,
    negativeEquityRolledIn: (row.equityCents ?? 0) < 0 && row.financingPath !== "CASH",
    downPaymentCents: row.downPaymentCents,
    financingPath: row.financingPath,
    amountFinancedCents: row.amountFinancedCents,
    estimatedPaymentCents: row.estimatedPaymentCents,
    delivery: row.delivery,
    plan: row.plan,
    buyerConfirmedAt: row.buyerConfirmedAt,
    dealerConfirmedAt: row.dealerConfirmedAt,
    supersededBy: row.supersededBy,
    disputeReason: row.disputeReason,
    createdAt: row.createdAt,
  };
}

/** §11a — the buyer accepts or declines one optional product. */
export async function decideOptionalProduct(params: {
  dealId: string;
  buyerId: string;
  productKey: string;
  accepted: boolean;
}): Promise<RecapView> {
  const deal = await prisma.deal.findFirst({
    where: { id: params.dealId, buyerId: params.buyerId },
    select: { id: true },
  });
  if (!deal) throw new RecapError("NOT_FOUND", "Deal not found.");

  const row = await prisma.dealRecap.findFirst({
    where: { dealId: params.dealId, supersededBy: null },
    orderBy: { version: "desc" },
  });
  if (!row) throw new RecapError("NO_RECAP", "There is no recap to decide on.");
  if (row.buyerConfirmedAt) {
    throw new RecapError("ALREADY_CONFIRMED", "You have already confirmed this recap.");
  }

  // READ-MODIFY-WRITE ON A JSON COLUMN, so the read and the write are one transaction.
  //
  // §11a requires every optional product to carry an EXPLICIT answer, and this is the only writer
  // of those answers. Outside a transaction, a buyer accepting GAP and declining the protection
  // package in quick succession — two tabs, or a fast double-tap on a slow connection — has both
  // handlers read the same array and the second write clobber the first. The lost decision reverts
  // to `accepted: null`, `confirmRecap` then refuses with PRODUCTS_UNDECIDED, and the buyer cannot
  // see which of their answers vanished.
  //
  // Serializable rather than Read Committed: the conflict is two writers of the same JSON value,
  // which Read Committed resolves by letting the later one win with a stale copy in hand. Prisma
  // surfaces the serialization failure as P2034, and the caller retries once — one retry, because
  // a genuine second conflict means a third writer nobody designed for.
  await runSerializable(async (tx) => {
    const current = await tx.dealRecap.findUnique({
      where: { id: row.id },
      select: { optionalProducts: true },
    });
    const products = Array.isArray(current?.optionalProducts)
      ? (current!.optionalProducts as unknown as OptionalProduct[])
      : [];
    const idx = products.findIndex((p) => p.key === params.productKey);
    if (idx < 0) throw new RecapError("NO_PRODUCT", "That product is not on this recap.");
    products[idx] = { ...products[idx]!, accepted: params.accepted };
    await tx.dealRecap.update({
      where: { id: row.id },
      data: { optionalProducts: products as unknown as Prisma.InputJsonValue },
    });
  });

  const view = await currentRecap(params.dealId);
  if (!view) throw new RecapError("BUILD_FAILED", "The recap could not be read back.");
  return view;
}

/** Every optional product answered — §11a's precondition for confirming. */
export function allProductsDecided(recap: RecapView): boolean {
  return recap.optionalProducts.every((p) => p.accepted !== null);
}

/**
 * §Stage 11 — "Buyer confirms. Dealership confirms." Either order; whichever is second exits the
 * stage.
 */
export async function confirmRecap(params: {
  dealId: string;
  actor: "BUYER" | "DEALER";
  actorId: string;
  now?: Date;
}): Promise<{ confirmed: boolean; bothConfirmed: boolean; advanced: boolean }> {
  const now = params.now ?? new Date();

  const row = await prisma.dealRecap.findFirst({
    where: { dealId: params.dealId, supersededBy: null },
    orderBy: { version: "desc" },
  });
  if (!row) throw new RecapError("NO_RECAP", "There is no recap to confirm.");

  // §Stage 11's FREEZE, enforced rather than described.
  //
  // `disputeRecap` computed `frozen` and put the word into the exception text — and then created
  // the next version and let both parties confirm it five minutes later. "Repeated failure
  // escalates to Operations with the Deal frozen at recap" has to survive the next confirmation
  // or it is a sentence in a queue row, not a control. The freeze lifts when the Operations row
  // is resolved, which is what "escalates to Operations" means: a human decides, not a timer.
  if (await isFrozenAtRecap(params.dealId)) {
    throw new RecapError(
      "FROZEN_AT_RECAP",
      "This deal has been disputed more times than the recap stage allows and is with our " +
        "Operations team. It cannot be confirmed until they have reviewed it.",
    );
  }

  const view = await currentRecap(params.dealId);
  if (view && params.actor === "BUYER" && !allProductsDecided(view)) {
    // §11a — a product left undecided would first appear in the contract, which is the one thing
    // §11a forbids. Refused here rather than defaulted either way: defaulting to declined loses a
    // product the buyer wanted, defaulting to accepted charges them for one they did not.
    throw new RecapError(
      "PRODUCTS_UNDECIDED",
      "Accept or decline each optional product before confirming — nothing may first appear in your contract.",
    );
  }

  // Compare-and-set on the actor's own column: a double-click writes the first timestamp only.
  const updated = await prisma.dealRecap.updateMany({
    where:
      params.actor === "BUYER"
        ? { id: row.id, buyerConfirmedAt: null }
        : { id: row.id, dealerConfirmedAt: null },
    data: params.actor === "BUYER" ? { buyerConfirmedAt: now } : { dealerConfirmedAt: now },
  });

  const fresh = await prisma.dealRecap.findUnique({
    where: { id: row.id },
    select: { buyerConfirmedAt: true, dealerConfirmedAt: true },
  });
  const bothConfirmed = !!fresh?.buyerConfirmedAt && !!fresh?.dealerConfirmedAt;

  if (bothConfirmed) {
    await prisma.deal.update({
      where: { id: params.dealId },
      data: {
        recapConfirmedByBuyerAt: fresh!.buyerConfirmedAt,
        recapConfirmedByDealerAt: fresh!.dealerConfirmedAt,
      },
    });
    await cancelByKey(recapCancelKey(params.dealId), "both parties confirmed the recap").catch(() => undefined);
  }

  const advanced = bothConfirmed
    ? await advanceDealStatus(params.dealId, DealStatus.FINANCING_PENDING, {
        actorId: params.actorId,
        actorRole: params.actor,
        reason: "Stage 11 complete: both parties confirmed the recap.",
        expectedFrom: DealStatus.RECAP_PENDING,
      })
    : false;

  return { confirmed: updated.count > 0, bothConfirmed, advanced };
}

/**
 * Is this deal frozen at recap? Two conditions, both required:
 *
 *  1. the dispute count is ABOVE `RECAP_DISPUTE_THRESHOLD` — the owner ruled N = 2 at STOP 1, so
 *     the third dispute freezes; and
 *  2. the Operations row that escalation opened is still OPEN, ASSIGNED or ESCALATED.
 *
 * The second condition is what makes this a freeze rather than a wall: resolving the queue item is
 * the Operations decision §Stage 11 asks for, and the deal moves again once it is taken. There is
 * no separate "unfreeze" to build, and nothing here can unfreeze itself.
 *
 * `FROZEN_PENDING_RELEASE` is deliberately not used — that status is Phase 10's coordinated unwind
 * of an EXECUTED contract, and a deal stuck at recap has no contract.
 */
async function isFrozenAtRecap(dealId: string): Promise<boolean> {
  const disputes = await prisma.dealRecap.count({
    where: { dealId, disputeReason: { not: null } },
  });
  if (disputes <= RECAP_DISPUTE_THRESHOLD) return false;
  const open = await prisma.queueItem.count({
    where: {
      dealId,
      exceptionCode: "RECAP_DISPUTED",
      status: { in: ["OPEN", "ASSIGNED", "ESCALATED"] },
    },
  });
  return open > 0;
}

/**
 * §Stage 11 — "A disputed figure returns to the dealership for correction and produces a new
 * recap version. Repeated failure escalates to Operations with the Deal frozen at recap."
 *
 * The new version is created here, EMPTY of confirmations, carrying the same figures. The
 * dealership corrects it and both parties confirm again. The old row is superseded rather than
 * edited, so the disputed figure and the reason stay on the record.
 */
export async function disputeRecap(params: {
  dealId: string;
  actor: "BUYER" | "DEALER";
  actorId: string;
  reason: string;
  now?: Date;
}): Promise<{ version: number; frozen: boolean }> {
  const now = params.now ?? new Date();
  if (!params.reason.trim()) throw new RecapError("REASON_REQUIRED", "Say which figure is wrong.");

  const row = await prisma.dealRecap.findFirst({
    where: { dealId: params.dealId, supersededBy: null },
    orderBy: { version: "desc" },
  });
  if (!row) throw new RecapError("NO_RECAP", "There is no recap to dispute.");

  const priorDisputes = await prisma.dealRecap.count({
    where: { dealId: params.dealId, disputeReason: { not: null } },
  });
  const disputesAfterThis = priorDisputes + 1;
  const frozen = disputesAfterThis > RECAP_DISPUTE_THRESHOLD;

  // Same determinism for a dispute version: two operators disputing the same recap at once must
  // produce ONE version 2, not two, or the supersession chain forks.
  const newId = recapId(params.dealId, row.version + 1);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.dealRecap.update({
        where: { id: row.id },
        data: { disputeReason: params.reason, supersededBy: newId, updatedAt: now },
      });
      await tx.dealRecap.create({
        data: {
          id: newId,
          dealId: params.dealId,
          version: row.version + 1,
          itemized: row.itemized ?? Prisma.JsonNull,
          optionalProducts: row.optionalProducts ?? Prisma.JsonNull,
          preliminaryAllowanceCents: row.preliminaryAllowanceCents,
          payoffGoodThroughDate: row.payoffGoodThroughDate,
          equityCents: row.equityCents,
          downPaymentCents: row.downPaymentCents,
          financingPath: row.financingPath,
          amountFinancedCents: row.amountFinancedCents,
          estimatedPaymentCents: row.estimatedPaymentCents,
          delivery: row.delivery ?? Prisma.JsonNull,
          plan: row.plan,
          createdAt: now,
          updatedAt: now,
        },
      });
      // The confirmations on the Deal go with the superseded version — a deal whose recap is in
      // dispute is not a deal both parties have agreed.
      await tx.deal.update({
        where: { id: params.dealId },
        data: { recapConfirmedByBuyerAt: null, recapConfirmedByDealerAt: null },
      });
    });
  } catch (err) {
    // P2002 on the new version's primary key: another dispute on the SAME recap version committed
    // first, so `newId` already exists. The transaction aborts, which is the correct outcome — this
    // caller's reason was NOT recorded, and reporting a version it did not create would put a
    // dispute on the record that no row carries. The supersession chain stays linear, and the
    // caller is told plainly that the correction round they are joining is already open.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new RecapError(
        "RECAP_SUPERSEDED",
        `This recap was already disputed and version ${row.version + 1} is open for correction. ` +
          "Reload it and raise anything still wrong against the new version.",
      );
    }
    throw err;
  }

  await raiseException({
    code: "RECAP_DISPUTED",
    dealId: params.dealId,
    // One row per DISPUTE, not per deal: each dispute is its own correction for the dealership.
    idempotencyKey: `RECAP_DISPUTED:${params.dealId}:v${row.version}`,
    detail: frozen
      ? `Dispute ${disputesAfterThis} on this deal — above the threshold of ${RECAP_DISPUTE_THRESHOLD}. ` +
        `The deal is FROZEN at recap pending an Operations decision. Disputed: ${params.reason}`
      : `Disputed by the ${params.actor.toLowerCase()}: ${params.reason}. Version ${row.version + 1} is open for correction.`,
  }).catch((err) => {
    logger.error("recap dispute: raiseException failed", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await notifyRecapReady(params.dealId, row.version + 1, null, true);
  return { version: row.version + 1, frozen };
}

async function notifyRecapReady(
  dealId: string,
  version: number,
  otdCents: number | null,
  isRevision: boolean,
): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      buyer: { select: { firstName: true, user: { select: { email: true } } } },
      dealerId: true,
      offer: {
        select: {
          dealerId: true,
          externalDealerName: true,
          externalDealerEmail: true,
          dealer: {
            select: { dealershipName: true, isSystemPlaceholder: true, user: { select: { email: true } } },
          },
        },
      },
    },
  });
  if (!deal) return;

  // §Stage 11 — "presented to BOTH buyer and dealership". Two recipients, two rows, one key each.
  if (deal.buyer?.user?.email) {
    const content = renderRecapReady({
      recipientName: deal.buyer.firstName,
      version,
      otdCents,
      dealId,
      forDealer: false,
      isRevision,
    });
    await enqueueOrRaise({
      triggerEvent: "recap_ready",
      templateKey: PHASE_7_TEMPLATES.RECAP_READY,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to: deal.buyer.user.email,
      payload: {
        email: deal.buyer.user.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
      },
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.RECAP_READY}:buyer:${dealId}:v${version}`,
      cancelKey: recapCancelKey(dealId),
    }, {
      buyerId: deal.buyerId,
      idempotencyKey: `RECAP_NOTICE_ENQUEUE_FAILED:buyer:${dealId}:v${version}`,
      detail:
        `Recap v${version} exists and the buyer's copy could not be enqueued. §Stage 11 needs BOTH ` +
        "parties to confirm before the deal moves, so an unsent recap is a deal that stops here " +
        "with nobody able to tell why.",
    });
  }

  const dealerEmail = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerEmail
    : deal.offer?.dealer?.user?.email ?? null;
  if (dealerEmail) {
    const content = renderRecapReady({
      recipientName: deal.offer?.dealer?.isSystemPlaceholder
        ? deal.offer.externalDealerName ?? "Team"
        : deal.offer?.dealer?.dealershipName ?? "Team",
      version,
      otdCents,
      dealId,
      forDealer: true,
      isRevision,
    });
    await enqueueOrRaise({
      triggerEvent: "recap_ready",
      templateKey: PHASE_7_TEMPLATES.RECAP_READY,
      channel: "email",
      recipientKind: "dealer",
      recipientId: deal.offer?.dealerId ?? null,
      to: dealerEmail,
      payload: { email: dealerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.RECAP_READY}:dealer:${dealId}:v${version}`,
      cancelKey: recapCancelKey(dealId),
    }, {
      dealerId: deal.offer?.dealerId ?? null,
      idempotencyKey: `RECAP_NOTICE_ENQUEUE_FAILED:dealer:${dealId}:v${version}`,
      detail:
        `Recap v${version} exists and the dealership's copy could not be enqueued. The dealership ` +
        "confirms on its own deal page; without the notice it does not know the recap is waiting, " +
        "and §Stage 11's exit needs its confirmation.",
    });
  }
}

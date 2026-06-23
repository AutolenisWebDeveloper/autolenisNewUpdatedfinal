// Document-to-deal association: identifier cross-validation contract.
// Locks the DB-independent guard that prevents a correct deal id paired with
// the wrong buyer / VIN / transaction from being mis-associated.
//
// Run with:  npx tsx --test lib/services/dealer/__tests__/deal-document-link.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { DocumentType } from "@prisma/client";
import {
  assertIdentifiersMatch,
  normalizeVin,
  DealDocumentError,
  type DealDocumentInput,
  type ResolvedDealAssociation,
} from "../deal-document-link.service";

const resolved: ResolvedDealAssociation = {
  dealId: "deal-1",
  buyerId: "buyer-1",
  dealerId: "dealer-1",
  transactionId: "pi_abc123",
  vins: ["1HGCM82633A004352"],
};

function input(overrides: Partial<DealDocumentInput>): DealDocumentInput {
  return {
    dealerId: "dealer-1",
    dealId: "deal-1",
    type: DocumentType.SALES_CONTRACT,
    name: "contract.pdf",
    url: "https://example.com/contract.pdf",
    ...overrides,
  };
}

test("normalizeVin trims and upper-cases", () => {
  assert.equal(normalizeVin("  1hgcm82633a004352 "), "1HGCM82633A004352");
});

test("passes when no expected identifiers are supplied", () => {
  assert.doesNotThrow(() => assertIdentifiersMatch(input({}), resolved));
});

test("passes when all supplied identifiers match (VIN case-insensitive)", () => {
  assert.doesNotThrow(() =>
    assertIdentifiersMatch(
      input({ expectedBuyerId: "buyer-1", expectedTransactionId: "pi_abc123", expectedVin: "1hgcm82633a004352" }),
      resolved,
    ),
  );
});

test("rejects a buyer mismatch", () => {
  assert.throws(
    () => assertIdentifiersMatch(input({ expectedBuyerId: "buyer-2" }), resolved),
    (e: unknown) => e instanceof DealDocumentError && e.code === "BUYER_MISMATCH" && e.status === 409,
  );
});

test("rejects a transaction mismatch", () => {
  assert.throws(
    () => assertIdentifiersMatch(input({ expectedTransactionId: "pi_other" }), resolved),
    (e: unknown) => e instanceof DealDocumentError && e.code === "TRANSACTION_MISMATCH",
  );
});

test("rejects a VIN mismatch when the deal has known VINs", () => {
  assert.throws(
    () => assertIdentifiersMatch(input({ expectedVin: "WAUZZZ8K9AA000000" }), resolved),
    (e: unknown) => e instanceof DealDocumentError && e.code === "VIN_MISMATCH",
  );
});

test("skips VIN validation when the deal carries no known VIN", () => {
  assert.doesNotThrow(() =>
    assertIdentifiersMatch(input({ expectedVin: "ANYTHING" }), { ...resolved, vins: [] }),
  );
});

test("skips transaction validation when the deal has no transaction id yet", () => {
  assert.doesNotThrow(() =>
    assertIdentifiersMatch(input({ expectedTransactionId: "pi_whatever" }), { ...resolved, transactionId: null }),
  );
});

// §11 privacy boundary — buyer/dealer DTOs must NEVER carry raw forensic evidence
// (IP, user-agent, consent snapshot, internal identifiers). Enforced by the shape
// of the returned object (allow-list), not by frontend hiding. The admin package
// carries the full record. These assert the field-level boundary directly.

import test from "node:test";
import assert from "node:assert/strict";
import { toBuyerEnvelopeSummary, toDealerEnvelopeSummary, toAdminEvidencePackage } from "../esign-dto";

// A fully-populated envelope row including every forensic field.
const rawEnvelope = {
  id: "env_1",
  dealId: "d1",
  docusignEnvelopeId: null,
  status: "COMPLETED",
  documentKey: null,
  sentAt: new Date(),
  completedAt: new Date(),
  voidedAt: null,
  voidReason: null,
  documentVersionId: "cv_1",
  documentHash: "hash",
  signerUserId: "user_internal_id",
  signerRole: "BUYER",
  signerName: "Sam Buyer",
  signerEmail: "sam@example.com",
  consentedToElectronic: true,
  consentedAt: new Date(),
  signatureText: "Sam Buyer",
  signedAt: new Date(),
  viewedAt: new Date(),
  ipAddress: "203.0.113.7",
  userAgent: "Mozilla/5.0 (secret device fingerprint)",
  declineReason: null,
  expiresAt: new Date(),
  certificatePdfPath: "buyer-contracts/d1/env_1.pdf",
  certificateGeneratedAt: new Date(),
  consentPolicyVersion: "DRAFT_V1",
  consentSnapshot: { ipAddress: "203.0.113.7", userAgent: "secret", signerUserId: "user_internal_id" },
  executedDocumentKey: "executed/d1/env_1.pdf",
  executedDocumentHash: "exec-hash",
  executedGeneratedAt: new Date(),
  confirmationsSentAt: new Date(),
  attemptNumber: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Parameters<typeof toAdminEvidencePackage>[0];

const FORBIDDEN = ["ipAddress", "userAgent", "consentSnapshot", "signerUserId", "executedDocumentKey", "executedDocumentHash", "certificatePdfPath", "voidReason", "declineReason"];

test("buyer summary exposes a safe status/timestamp view and NO forensic evidence", () => {
  const dto = toBuyerEnvelopeSummary(rawEnvelope)!;
  for (const key of FORBIDDEN) {
    assert.ok(!(key in dto), `buyer DTO must not expose ${key}`);
  }
  // safe fields present
  assert.equal(dto.status, "COMPLETED");
  assert.equal(dto.executedContractAvailable, true);
  assert.equal(dto.certificateAvailable, true);
  assert.equal(dto.documentVersionId, "cv_1");
  // full serialization contains neither the IP nor the UA anywhere
  const json = JSON.stringify(dto);
  assert.ok(!json.includes("203.0.113.7"), "no IP in buyer DTO");
  assert.ok(!json.includes("secret"), "no user-agent / snapshot leakage in buyer DTO");
});

test("dealer summary is even more minimal and carries NO forensic evidence", () => {
  const dto = toDealerEnvelopeSummary(rawEnvelope)!;
  for (const key of [...FORBIDDEN, "documentHash", "signerEmail", "signerName"]) {
    assert.ok(!(key in dto), `dealer DTO must not expose ${key}`);
  }
  assert.equal(dto.executedContractAvailable, true);
  const json = JSON.stringify(dto);
  assert.ok(!json.includes("203.0.113.7") && !json.includes("secret"), "no forensic leakage in dealer DTO");
});

test("admin evidence package DOES carry the full forensic record", () => {
  const pkg = toAdminEvidencePackage(rawEnvelope, []);
  assert.equal(pkg.envelope.ipAddress, "203.0.113.7", "admin export includes raw IP");
  assert.ok(pkg.envelope.consentSnapshot, "admin export includes the consent snapshot");
  assert.ok(Array.isArray(pkg.history));
});

test("null envelope shapes to null (no crash)", () => {
  assert.equal(toBuyerEnvelopeSummary(null), null);
  assert.equal(toDealerEnvelopeSummary(undefined), null);
});

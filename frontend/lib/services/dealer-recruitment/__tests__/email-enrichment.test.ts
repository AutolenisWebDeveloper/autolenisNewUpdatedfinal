// WO-3 regression tests — the Internet Sales Manager contact must persist
// INDEPENDENTLY of whether a verifiable email was found.
//
// Run with:  npx tsx --test lib/services/dealer-recruitment/__tests__/email-enrichment.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  parseEnrichment,
  buildPersistData,
  enrichDealerEmail,
  type GeminiResponse,
} from "../email-enrichment.service";

// Wrap a JSON object as a Gemini Search-grounding response.
function geminiResponse(obj: Record<string, unknown>, sourceUri?: string): GeminiResponse {
  return {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(obj) }] },
        groundingMetadata: sourceUri
          ? { groundingChunks: [{ web: { uri: sourceUri } }] }
          : undefined,
      },
    ],
  };
}

const NOW = new Date("2026-06-11T00:00:00.000Z");

// ─── The regression: named ISM, NO email ────────────────────────────────────

test("named ISM with null email is parsed and persisted (the reported bug)", () => {
  const parsed = parseEnrichment(
    geminiResponse({
      contactName: "Jane Rivera",
      contactTitle: "Internet Sales Manager",
      contactPhone: "555-200-1000",
      contactSourceUrl: "https://dealer.example.com/staff",
      contactConfidence: "high",
      email: null,
      sourceUrl: null,
      confidence: "none",
    }),
  );

  // Contact survives even though email is null.
  assert.equal(parsed.contactName, "Jane Rivera");
  assert.equal(parsed.contactTitle, "Internet Sales Manager");
  assert.equal(parsed.contactPhone, "555-200-1000");
  assert.equal(parsed.contactConfidence, "high");
  assert.equal(parsed.email, null);

  const data = buildPersistData(parsed, NOW);
  // Contact fields are written...
  assert.equal(data.contactName, "Jane Rivera");
  assert.equal(data.contactTitle, "Internet Sales Manager");
  assert.equal(data.contactPhone, "555-200-1000");
  assert.equal(data.contactSource, "gemini_search_high_confidence");
  assert.equal(data.contactConfidence, "high");
  assert.equal(data.contactSourceUrl, "https://dealer.example.com/staff");
  // ...with NO email written, and both timestamps advanced.
  assert.equal(data.email, undefined);
  assert.equal(data.emailSource, undefined);
  assert.equal(data.contactEnrichedAt, NOW);
  assert.equal(data.emailEnrichedAt, NOW);
});

// ─── Name + email: both persist ─────────────────────────────────────────────

test("named ISM with a valid email persists both contact and email", () => {
  const parsed = parseEnrichment(
    geminiResponse({
      contactName: "Carlos Mendez",
      contactTitle: "Internet Director",
      contactPhone: null,
      contactSourceUrl: "https://dealer.example.com/team",
      contactConfidence: "high",
      email: "carlos.mendez@dealer.com",
      sourceUrl: "https://dealer.example.com/team",
      confidence: "high",
    }),
  );

  assert.equal(parsed.email, "carlos.mendez@dealer.com");
  assert.equal(parsed.contactName, "Carlos Mendez");

  const data = buildPersistData(parsed, NOW);
  assert.equal(data.email, "carlos.mendez@dealer.com");
  assert.equal(data.emailSource, "gemini_search_high_confidence");
  assert.equal(data.contactName, "Carlos Mendez");
  assert.equal(data.contactSource, "gemini_search_high_confidence");
});

// ─── Nothing real: fabricate nothing, only advance timestamps ───────────────

test("no real contact and no email fabricates nothing", () => {
  const parsed = parseEnrichment(
    geminiResponse({
      contactName: null,
      contactTitle: null,
      contactPhone: null,
      contactSourceUrl: null,
      contactConfidence: "none",
      email: null,
      sourceUrl: null,
      confidence: "none",
    }),
  );

  assert.equal(parsed.contactName, null);
  assert.equal(parsed.email, null);

  const data = buildPersistData(parsed, NOW);
  assert.equal(data.contactName, undefined);
  assert.equal(data.email, undefined);
  // Recency guard still advances even on a miss.
  assert.equal(data.contactEnrichedAt, NOW);
  assert.equal(data.emailEnrichedAt, NOW);
});

// ─── Anti-fabrication: a confidence label without a name yields no contact ──

test("confidence label without a real name does not conjure a contact", () => {
  const parsed = parseEnrichment(
    geminiResponse({
      contactName: null,
      contactTitle: "Internet Sales Manager",
      contactConfidence: "high",
      email: null,
      confidence: "none",
    }),
  );

  assert.equal(parsed.contactName, null);
  assert.equal(parsed.contactTitle, null);
  assert.equal(parsed.contactConfidence, "none");

  const data = buildPersistData(parsed, NOW);
  assert.equal(data.contactName, undefined);
  assert.equal(data.contactTitle, undefined);
});

// ─── A model that emits an email under confidence:"none" is distrusted ──────

test("email emitted under confidence none is dropped", () => {
  const parsed = parseEnrichment(
    geminiResponse({
      contactName: "Pat Lee",
      contactTitle: "Sales Manager",
      contactConfidence: "medium",
      email: "guessed@dealer.com",
      confidence: "none",
    }),
  );

  // Email distrusted, but the contact still persists.
  assert.equal(parsed.email, null);
  assert.equal(parsed.contactName, "Pat Lee");

  const data = buildPersistData(parsed, NOW);
  assert.equal(data.email, undefined);
  assert.equal(data.contactName, "Pat Lee");
  assert.equal(data.contactSource, "gemini_search_medium_confidence");
});

// ─── Y1 — persist:false is read-only: parse + return, but NO DB write ────────

test("enrichDealerEmail persist:false returns the parsed email WITHOUT writing to the DB", async () => {
  process.env.GEMINI_API_KEY = "test-key";

  // Spy on the two write/read paths. force:true skips the recency-guard read, so
  // in persist:false mode NO prisma method should be touched at all.
  const updateSpy = mock.fn(async () => ({}));
  const findUniqueSpy = mock.fn(async () => null);
  const origUpdate = prisma.dealerProspect.update;
  const origFindUnique = prisma.dealerProspect.findUnique;
  prisma.dealerProspect.update = updateSpy as unknown as typeof prisma.dealerProspect.update;
  prisma.dealerProspect.findUnique =
    findUniqueSpy as unknown as typeof prisma.dealerProspect.findUnique;

  const origFetch = global.fetch;
  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify(
        geminiResponse({
          contactName: "Dana Ruiz",
          contactTitle: "Internet Sales Manager",
          contactPhone: null,
          contactSourceUrl: "https://dealer.example.com/staff",
          contactConfidence: "high",
          email: "dana.ruiz@dealer.com",
          sourceUrl: "https://dealer.example.com/staff",
          confidence: "high",
        }),
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  ) as unknown as typeof global.fetch;

  try {
    const result = await enrichDealerEmail({
      dealerProspectId: "p_readonly",
      dealerName: "Dealer Example",
      city: "Dallas",
      state: "TX",
      website: "https://dealer.example.com",
      force: true, // skip recency-guard read
      persist: false, // read-only
    });

    // Parsed result is returned intact...
    assert.equal(result.email, "dana.ruiz@dealer.com");
    assert.equal(result.source, "gemini_search_high_confidence");
    assert.equal(result.contactName, "Dana Ruiz");
    // ...and NOTHING was persisted.
    assert.equal(updateSpy.mock.callCount(), 0);
    assert.equal(findUniqueSpy.mock.callCount(), 0);
  } finally {
    prisma.dealerProspect.update = origUpdate;
    prisma.dealerProspect.findUnique = origFindUnique;
    global.fetch = origFetch;
  }
});

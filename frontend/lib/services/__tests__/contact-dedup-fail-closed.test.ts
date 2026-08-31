// ContactService.upsertContact — the dedup boundary must FAIL CLOSED.
//
// WHY THIS EXISTS. `upsertContact` is the single funnel through which ~20 call
// sites resolve a person to a CRM contact. Its contract is "email match → phone
// match → insert". Both lookups destructured only `data` and discarded `error`,
// so a lookup that FAILED was indistinguishable from a lookup that found
// nothing — and the function fell through to INSERT. A dedup query that fails
// open does not degrade; it fabricates.
//
// That is not hypothetical. `.maybeSingle()` errors when a filter matches more
// than one row, so once two live rows shared a phone, EVERY later upsert for
// that phone took the insert branch. `contacts` has a UNIQUE partial index on
// lower(email) but only a PLAIN index on phone, so the database silently
// permitted exactly the email-less duplicates and rejected the rest — which is
// why every fabricated row observed in production had `email IS NULL`.
//
// The second hole is `normalizePhone`, which returns '' (not null) for an
// unparseable number. '' is falsy, so the phone lookup was SKIPPED entirely and
// the row was inserted with `phone: ''` — an identity that can never match
// anything, guaranteeing a fresh duplicate on every subsequent call.
//
//   pnpm test:operations

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ContactService } from "@/lib/services/contact.service";

type Row = Record<string, unknown>;
type Resp = { data: Row | null; error: { message: string } | null };

let lookups: Resp[] = [];
let inserted: Row[] = [];
let updated: Array<{ id: unknown; patch: Row }> = [];

/** Minimal Supabase surface: the exact chains upsertContact builds. */
function client() {
  return {
    from: () => {
      const state: { op?: string; payload?: Row; eqs: Array<[string, unknown]> } = { eqs: [] };
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        is: () => b,
        eq: (col: string, val: unknown) => {
          state.eqs.push([col, val]);
          return b;
        },
        // Each dedup lookup consumes the next scripted response.
        maybeSingle: async () => lookups.shift() ?? { data: null, error: null },
        insert: (payload: Row) => {
          state.op = "insert";
          state.payload = payload;
          return b;
        },
        update: (payload: Row) => {
          state.op = "update";
          state.payload = payload;
          return b;
        },
        single: async () => {
          if (state.op === "insert") {
            inserted.push(state.payload as Row);
            return { data: { id: "inserted-id", ...state.payload }, error: null };
          }
          updated.push({
            id: state.eqs.find(([c]) => c === "id")?.[1],
            patch: state.payload as Row,
          });
          return { data: { id: "existing-id", ...state.payload }, error: null };
        },
      });
      return b;
    },
  } as never;
}

beforeEach(() => {
  lookups = [];
  inserted = [];
  updated = [];
});

// ─── Fail closed on a failed lookup ──────────────────────────────────────────

test("an EMAIL dedup lookup that errors must not fall through to an insert", async () => {
  lookups = [{ data: null, error: { message: "timeout" } }];
  await assert.rejects(
    () => ContactService.upsertContact(client(), { email: "ada@example.com", source: "public_form" }),
    /dedup/i,
    "a failed identity lookup must be raised, never read as 'no match'",
  );
  assert.equal(inserted.length, 0, "a failed lookup must never mint a contact");
});

test("a PHONE dedup lookup that errors must not mint a duplicate", async () => {
  // This is the production trigger: .maybeSingle() errors when two live rows
  // already share the phone, so the fail-open branch fired on every call.
  lookups = [{ data: null, error: { message: "PGRST116: multiple rows returned" } }];
  await assert.rejects(
    () => ContactService.upsertContact(client(), { phone: "+14695359785", source: "public_form" }),
    /dedup/i,
  );
  assert.equal(inserted.length, 0, "an ambiguous identity must halt, not duplicate");
});

// ─── Unparseable phone ───────────────────────────────────────────────────────

test("an unparseable phone is never stored as an empty string", async () => {
  lookups = [{ data: null, error: null }]; // email lookup finds nothing
  await ContactService.upsertContact(client(), {
    email: "ada@example.com",
    phone: "555-1234", // 7 digits — normalizePhone yields ''
    source: "public_form",
  });
  assert.equal(inserted.length, 1);
  assert.equal(
    inserted[0].phone,
    null,
    "'' is an identity that matches nothing and duplicates forever; store NULL",
  );
});

test("a contact with NO usable identity is refused, not inserted", async () => {
  // No email and an unparseable phone => nothing to dedup on. Inserting here
  // guarantees a fresh row on every call. The admin create route already
  // enforces EMAIL_OR_PHONE_REQUIRED; this makes it true at the funnel.
  await assert.rejects(
    () => ContactService.upsertContact(client(), { phone: "555-1234", source: "public_form" }),
    /identity/i,
  );
  assert.equal(inserted.length, 0);
});

// ─── The contract that must still hold ───────────────────────────────────────

test("a phone match still UPDATES the existing contact rather than inserting", async () => {
  lookups = [{ data: { id: "existing-id", email: null, phone: "+14695359785" }, error: null }];
  await ContactService.upsertContact(client(), { phone: "+14695359785", source: "public_form" });
  assert.equal(inserted.length, 0);
  assert.equal(updated.length, 1);
});

test("a genuinely new contact is still inserted exactly once", async () => {
  lookups = [{ data: null, error: null }];
  await ContactService.upsertContact(client(), { email: "new@example.com", source: "public_form" });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].email, "new@example.com");
});

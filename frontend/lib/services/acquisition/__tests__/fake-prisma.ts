// A small in-memory Prisma stand-in for the intake tests.
//
// The intake service now runs inside `$transaction` and touches six models, so
// each test hand-rolling its own partial mock produced six subtly different
// fakes — and the differences, not the service, decided what the tests proved.
// This is one fake, shared, with the two behaviours that actually matter modelled
// faithfully:
//
//   • `users.email` is UNIQUE and a duplicate insert raises P2002;
//   • `vehicle_requests_one_open_per_buyer_key` is a PARTIAL unique index over the
//     ten open statuses, and a second open row for one buyer raises P2002.
//
// Those two constraints are what the one-open-request compare-and-swap and the
// rule-16 negative test are about, so a fake that did not enforce them would let
// both pass while the real database rejected the write.
//
// It is deliberately not a general Prisma emulator: it implements the calls this
// service makes, and throws on anything else so an untested path is loud.

const OPEN_STATUSES = new Set([
  "DRAFT",
  "SUBMITTED",
  "INTAKE",
  "PAYMENT_REQUIRED",
  "ACTIVE_SOURCING",
  "RADIUS_AUTHORIZATION_REQUIRED",
  "OFFER_READY",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
]);

export type Row = Record<string, unknown>;

export interface FakeState {
  users: Map<string, Row>;
  buyers: Map<string, Row>;
  opportunities: Map<string, Row>;
  vehicleRequests: Map<string, Row>;
  claimTokens: Map<string, Row>;
  commsOutbox: Map<string, Row>;
  queueItems: Map<string, Row>;
  queueKeys: Set<string>;
  seq: number;
}

export interface FakeDb {
  client: Record<string, unknown>;
  state: FakeState;
  reset(): void;
}

function p2002(target: string): Error & { code: string; meta: { target: string[] } } {
  const err = new Error(`Unique constraint failed on ${target}`) as Error & { code: string; meta: { target: string[] } };
  err.code = "P2002";
  err.meta = { target: [target] };
  return err;
}

function matches(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object") {
      const cond = v as Record<string, unknown>;
      if ("in" in cond) {
        if (!(cond.in as unknown[]).includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (cond.not === null) {
          if (row[k] === null || row[k] === undefined) return false;
        } else if (row[k] === cond.not) return false;
        continue;
      }
      if ("gt" in cond) {
        if (!(row[k] instanceof Date) || (row[k] as Date) <= (cond.gt as Date)) return false;
        continue;
      }
      return false;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function pick(row: Row, select: Row | undefined): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k] ?? null;
    else if (v && typeof v === "object") out[k] = row[k] ?? null;
  }
  return out;
}

export function makeFakePrisma(): FakeDb {
  const state: FakeState = {
    users: new Map(),
    buyers: new Map(),
    opportunities: new Map(),
    vehicleRequests: new Map(),
    claimTokens: new Map(),
    commsOutbox: new Map(),
    queueItems: new Map(),
    queueKeys: new Set(),
    seq: 0,
  };
  const id = (prefix: string) => `${prefix}_${++state.seq}`;

  const userModel = {
    findUnique: async ({ where, select, include }: { where: Row; select?: Row; include?: Row }) => {
      const row = [...state.users.values()].find((u) => matches(u, where));
      if (!row) return null;
      const out = select ? pick(row, select) : { ...row };
      if (select?.buyer || include?.buyer) {
        const buyer = [...state.buyers.values()].find((b) => b.userId === row.id) ?? null;
        out.buyer = buyer ? { id: buyer.id, zip: buyer.zip ?? null } : null;
      }
      return out;
    },
    create: async ({ data, select }: { data: Row; select?: Row }) => {
      if ([...state.users.values()].some((u) => u.email === data.email)) throw p2002("users.email");
      const row = { id: id("user"), ...data };
      state.users.set(row.id as string, row);
      return select ? pick(row, select) : row;
    },
  };

  const buyerModel = {
    findUnique: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = state.buyers.get(where.id as string);
      if (!row) return null;
      const out = select ? pick(row, select) : { ...row };
      if (select?.user) {
        const user = state.users.get(row.userId as string);
        out.user = user ? { supabaseId: user.supabaseId } : null;
      }
      return out;
    },
    findMany: async ({ where, select, take }: { where: Row; select?: Row; take?: number }) =>
      [...state.buyers.values()]
        .filter((b) => matches(b, where))
        .slice(0, take ?? 100)
        .map((b) => pick(b, select)),
    create: async ({ data, select }: { data: Row; select?: Row }) => {
      // `Buyer.userId` is @unique (schema.prisma:32) — one buyer profile per user.
      // The fake enforces it because the concurrency case turns on it: two racing
      // captures that both reuse one user must not produce two buyers.
      if ([...state.buyers.values()].some((b) => b.userId === data.userId)) throw p2002("buyers.user_id");
      const row = { id: id("buyer"), zip: null, city: null, state: null, ...data };
      state.buyers.set(row.id as string, row);
      return select ? pick(row, select) : row;
    },
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = [...state.buyers.values()].find((b) => matches(b, where));
      return row ? pick(row, select) : null;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.buyers.get(where.id as string);
      if (!row) throw new Error("buyer not found");
      Object.assign(row, data);
      return { ...row };
    },
  };

  const vehicleRequestModel = {
    findFirst: async ({ where, select, orderBy }: { where: Row; select?: Row; orderBy?: unknown }) => {
      void orderBy;
      const row = [...state.vehicleRequests.values()].find((r) => matches(r, where));
      return row ? (select ? pick(row, select) : { ...row }) : null;
    },
    create: async ({ data }: { data: Row }) => {
      // The partial unique index: at most one OPEN request per buyer.
      if (
        OPEN_STATUSES.has(data.status as string) &&
        [...state.vehicleRequests.values()].some(
          (r) => r.buyerId === data.buyerId && OPEN_STATUSES.has(r.status as string)
        )
      ) {
        throw p2002("vehicle_requests_one_open_per_buyer_key");
      }
      const row = { id: id("vr"), createdAt: new Date(), ...data };
      state.vehicleRequests.set(row.id as string, row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.vehicleRequests.get(where.id as string);
      if (!row) throw new Error("vehicleRequest not found");
      Object.assign(row, data);
      return { ...row };
    },
  };

  const opportunityModel = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: id("opp"), ...data };
      state.opportunities.set(row.id as string, row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.opportunities.get(where.id as string) ?? { id: where.id as string };
      Object.assign(row, data);
      state.opportunities.set(row.id as string, row);
      return { ...row };
    },
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = [...state.opportunities.values()].find((o) => matches(o, where));
      return row ? pick(row, select) : null;
    },
  };

  // `findFirst` alone was a hole with the same shape as the one the outbox comment
  // below describes, and it hid a shipped feature rather than proving it. The
  // registered-claim branch MINTS a token (`issueResumeToken`) inside the intake
  // transaction, and the call site swallows its own failure by design — "the capture
  // still stands, and the visitor was told to check their email". With no `create`
  // here, every unit test threw at the mint, was swallowed, and passed: the claim
  // link that commit 54c427d shipped as a blocking fix had NEVER executed in a test.
  // `updateMany` is the consume half, on the write path.
  const claimTokenModel = {
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = [...state.claimTokens.values()].find((t) => matches(t, where));
      return row ? pick(row, select) : null;
    },
    create: async ({ data }: { data: Row }) => {
      // `token_hash` is UNIQUE in the schema; a fake that let two rows share one
      // would model a database this repository does not have.
      if ([...state.claimTokens.values()].some((t) => t.tokenHash === data.tokenHash)) {
        throw p2002("buyer_request_claim_tokens.token_hash");
      }
      const row = { id: id("tok"), consumedAt: null, vehicleRequestId: null, ...data };
      state.claimTokens.set(row.id as string, row);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of state.claimTokens.values()) {
        if (!matches(row, where)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    },
  };

  // Enough of comms_outbox for the intake path: the §6.4 sequence is enqueued at
  // capture and cancelled by its shared key when the draft is completed. Both are
  // writes the intake transaction performs, so a fake without them would throw on
  // the promotion path and hide it rather than prove it.
  const commsOutboxModel = {
    create: async ({ data }: { data: Row }) => {
      if ([...state.commsOutbox.values()].some((r) => r.dedupKey === data.dedupKey)) {
        throw p2002("comms_outbox.dedup_key");
      }
      const row = { id: id("outbox"), status: "pending", cancelledAt: null, ...data };
      state.commsOutbox.set(row.id as string, row);
      return { ...row };
    },
    findFirst: async ({ where }: { where: Row }) =>
      [...state.commsOutbox.values()].find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where: Row }) => [...state.commsOutbox.values()].filter((r) => matches(r, where)),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of state.commsOutbox.values()) {
        if (!matches(row, where)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = state.commsOutbox.get(where.id as string);
      if (!row) throw new Error(`comms_outbox row ${String(where.id)} not found`);
      Object.assign(row, data);
      return { ...row };
    },
  };

  const queueItemModel = {
    create: async ({ data }: { data: Row }) => {
      const key = data.idempotencyKey as string | null;
      if (key && state.queueKeys.has(key)) throw p2002("queue_items.idempotency_key");
      if (key) state.queueKeys.add(key);
      state.queueItems.set(data.id as string, { ...data });
      return { ...data };
    },
    findFirst: async ({ where }: { where: Row }) =>
      [...state.queueItems.values()].find((q) => matches(q, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => state.queueItems.get(where.id as string) ?? null,
    findMany: async ({ where }: { where: Row }) => [...state.queueItems.values()].filter((q) => matches(q, where)),
    updateMany: async () => ({ count: 1 }),
  };

  const models = {
    user: userModel,
    buyer: buyerModel,
    vehicleRequest: vehicleRequestModel,
    buyerOpportunity: opportunityModel,
    buyerRequestClaimToken: claimTokenModel,
    commsOutbox: commsOutboxModel,
    queueItem: queueItemModel,
  };

  const client = {
    ...models,
    // The service wraps its work in an interactive transaction; the fake runs the
    // callback against the same store. It does NOT model rollback — a test that
    // needs to prove atomicity asserts on the thrown error and the store, which is
    // enough to catch "wrote the lead, lost the request".
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
  };

  return {
    client,
    state,
    reset() {
      state.users.clear();
      state.buyers.clear();
      state.opportunities.clear();
      state.vehicleRequests.clear();
      state.claimTokens.clear();
      state.commsOutbox.clear();
      state.queueItems.clear();
      state.queueKeys.clear();
      state.seq = 0;
    },
  };
}

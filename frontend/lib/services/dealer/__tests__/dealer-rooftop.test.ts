// A2 — DealerRooftop resolver (cross-pool dedup + read-only make signal).
// Injected fake prisma + getPreferredMakes; runs under test:dealer, no mocks.
//   npx tsx --test lib/services/dealer/__tests__/dealer-rooftop.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { resolveRooftop, computeRooftopMakes } from "../dealer-rooftop.service";

type Rooftop = Record<string, unknown> & { id: string };
type Dealer = { id: string; rooftopId?: string | null };
type Prospect = { id: string; rooftopId?: string | null; brand?: string | null };

function fakePrisma(seed: { rooftops?: Rooftop[]; dealers?: Dealer[]; prospects?: Prospect[] } = {}) {
  const rooftops: Rooftop[] = [...(seed.rooftops ?? [])];
  const dealers: Dealer[] = [...(seed.dealers ?? [])];
  const prospects: Prospect[] = [...(seed.prospects ?? [])];
  let idc = rooftops.length;

  const matchClause = (r: Rooftop, c: Record<string, unknown>) => {
    const [k, v] = Object.entries(c)[0];
    return v != null && r[k] === v;
  };

  const prisma = {
    dealerRooftop: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const clauses = (where.OR as Record<string, unknown>[]) ?? [where];
        return rooftops.find((r) => clauses.some((c) => matchClause(r, c))) ?? null;
      },
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const clauses = (where.OR as Record<string, unknown>[]) ?? [where];
        const res = rooftops.filter((r) => clauses.some((c) => matchClause(r, c)));
        return take ? res.slice(0, take) : res;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.websiteHost && rooftops.some((r) => r.websiteHost === data.websiteHost)) {
          const e = new Error("Unique constraint failed") as Error & { code: string };
          e.code = "P2002";
          throw e;
        }
        const row: Rooftop = { id: `rf_${++idc}`, ...data };
        rooftops.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rooftops.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    dealer: {
      findMany: async ({ where }: { where: { rooftopId: string } }) =>
        dealers.filter((d) => d.rooftopId === where.rooftopId).map((d) => ({ id: d.id })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const d = dealers.find((x) => x.id === where.id);
        if (d) Object.assign(d, data);
        else dealers.push({ id: where.id, ...(data as object) } as Dealer);
        return d;
      },
    },
    dealerProspect: {
      findMany: async ({ where }: { where: { rooftopId: string } }) =>
        prospects.filter((p) => p.rooftopId === where.rooftopId).map((p) => ({ brand: p.brand ?? null })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = prospects.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        else prospects.push({ id: where.id, ...(data as object) } as Prospect);
        return p;
      },
    },
  };
  return { prisma, rooftops, dealers, prospects };
}

const deps = (prisma: unknown, getPreferredMakes: (id: string) => Promise<string[]> = async () => []) =>
  ({ prisma, getPreferredMakes }) as never;

// ─── create + link ───────────────────────────────────────────────────────────

test("a new dealership creates a rooftop, links the dealer, and reads makes from preferredMakes", async () => {
  const f = fakePrisma();
  const id = await resolveRooftop(
    { kind: "dealer", id: "d1", name: "Toyota of Dallas", website: "https://toyotaofdallas.com", zip: "75201" },
    deps(f.prisma, async () => ["Toyota"]),
  );
  assert.ok(id);
  assert.equal(f.rooftops.length, 1);
  assert.equal(f.rooftops[0].websiteHost, "toyotaofdallas.com");
  assert.equal(f.dealers.find((d) => d.id === "d1")?.rooftopId, id);
  assert.deepEqual(f.rooftops[0].makes, ["Toyota"]);
  assert.equal(f.rooftops[0].makesSource, "preferred_makes");
});

// ─── dedup by website host ───────────────────────────────────────────────────

test("a second candidate on the same host resolves to the SAME rooftop (no duplicate)", async () => {
  const f = fakePrisma();
  const id1 = await resolveRooftop(
    { kind: "prospect", id: "p1", name: "Toyota of Dallas", website: "toyotaofdallas.com" },
    deps(f.prisma),
  );
  const id2 = await resolveRooftop(
    { kind: "prospect", id: "p2", name: "TOD Internet Sales", website: "https://www.toyotaofdallas.com/new" },
    deps(f.prisma),
  );
  assert.equal(id1, id2);
  assert.equal(f.rooftops.length, 1);
});

// ─── prospect brand fallback ─────────────────────────────────────────────────

test("a prospect-only rooftop takes makes from brand (prospect_brand)", async () => {
  const f = fakePrisma();
  const id = await resolveRooftop(
    { kind: "prospect", id: "p1", name: "Kia of Plano", website: "kiaofplano.com" },
    deps(f.prisma),
  );
  // Persist the prospect's brand so computeRooftopMakes can read it.
  f.prospects.find((p) => p.id === "p1")!.brand = "Kia";
  const r = await computeRooftopMakes(id!, deps(f.prisma));
  assert.deepEqual(r.makes, ["Kia"]);
  assert.equal(r.source, "prospect_brand");
});

// ─── registered dealer wins ──────────────────────────────────────────────────

test("registered dealer preferredMakes win over a linked prospect's brand", async () => {
  const f = fakePrisma({
    rooftops: [{ id: "rf1", websiteHost: "toyotaofdallas.com", nameKey: "toyota of dallas" }],
    prospects: [{ id: "p1", rooftopId: "rf1", brand: "Kia" }],
  });
  const id = await resolveRooftop(
    { kind: "dealer", id: "d1", name: "Toyota of Dallas", website: "toyotaofdallas.com" },
    deps(f.prisma, async () => ["Toyota"]),
  );
  assert.equal(id, "rf1"); // resolved to the existing rooftop, no new row
  assert.equal(f.rooftops.length, 1);
  assert.deepEqual(f.rooftops[0].makes, ["Toyota"]);
  assert.equal(f.rooftops[0].makesSource, "preferred_makes");
});

// ─── weak keys are possible-matches, never auto-merged ───────────────────────

test("a phone-only match (weak key) is NOT auto-merged — a distinct rooftop is created", async () => {
  // Shared switchboards make phone a weak signal; auto-merging would collapse
  // distinct rooftops, so a phone-only match must create a distinct rooftop.
  const f = fakePrisma({
    rooftops: [{ id: "rf1", phoneKey: "+14695359785", nameKey: "dallas toyota" }],
  });
  const id = await resolveRooftop(
    { kind: "prospect", id: "p1", name: "Honda of Frisco", phone: "(469) 535-9785" },
    deps(f.prisma),
  );
  assert.notEqual(id, "rf1"); // NOT merged into the phone-sharing rooftop
  assert.equal(f.rooftops.length, 2);
});

// ─── M1: host-conflict veto ──────────────────────────────────────────────────

test("a name+zip match whose host conflicts is vetoed — a distinct rooftop is created", async () => {
  // rf1 is toyotaofdallas.com; a same name+zip candidate on a DIFFERENT host is a
  // different dealership → the strong name+zip match is vetoed, not merged.
  const f = fakePrisma({
    rooftops: [
      {
        id: "rf1",
        websiteHost: "toyotaofdallas.com",
        nameZipKey: "toyota of dallas|75201",
        nameKey: "toyota of dallas",
      },
    ],
  });
  const id = await resolveRooftop(
    { kind: "dealer", id: "d1", name: "Toyota of Dallas", website: "toyotaofdallas-annex.com", zip: "75201" },
    deps(f.prisma, async () => ["Toyota"]),
  );
  assert.notEqual(id, "rf1"); // host conflict → not merged
  assert.equal(f.rooftops.length, 2);
});

// ─── name+zip strong match (no host) merges ──────────────────────────────────

test("a name+zip match (no host on either side) resolves to the same rooftop", async () => {
  const f = fakePrisma({
    rooftops: [{ id: "rf1", nameZipKey: "toyota of dallas|75201", nameKey: "toyota of dallas", websiteHost: null }],
  });
  const id = await resolveRooftop(
    { kind: "prospect", id: "p1", name: "Toyota of Dallas Inc", zip: "75201" },
    deps(f.prisma),
  );
  assert.equal(id, "rf1");
  assert.equal(f.rooftops.length, 1);
});

// ─── backfill missing keys ───────────────────────────────────────────────────

test("resolving patches identity keys the existing rooftop was missing", async () => {
  const f = fakePrisma({
    rooftops: [{ id: "rf1", nameZipKey: "toyota of dallas|75201", nameKey: "toyota of dallas", websiteHost: null }],
  });
  await resolveRooftop(
    { kind: "prospect", id: "p1", name: "Toyota of Dallas", website: "toyotaofdallas.com", zip: "75201" },
    deps(f.prisma),
  );
  assert.equal(f.rooftops.length, 1);
  assert.equal(f.rooftops[0].websiteHost, "toyotaofdallas.com"); // backfilled
});

// ─── no usable name ──────────────────────────────────────────────────────────

test("a candidate with no usable name returns null and writes nothing", async () => {
  const f = fakePrisma();
  const id = await resolveRooftop({ kind: "prospect", id: "p1", name: "   " }, deps(f.prisma));
  assert.equal(id, null);
  assert.equal(f.rooftops.length, 0);
});

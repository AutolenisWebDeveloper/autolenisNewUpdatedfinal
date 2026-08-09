# Supabase connection setup (AutoLenis)

Authoritative, secret-free reference for pointing this app at its Supabase
Postgres database. **No secrets live in this file or in the repo.** Passwords and
keys go only in `frontend/.env.local` (gitignored) locally, or in the Vercel /
CI environment for deployments.

Source of truth for the datasource wiring is `prisma/schema.prisma`
(`datasource db` → `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")`)
and `env.d.ts`. See also the **Database URLs** section of `frontend/README.md`.

## Project coordinates

| Field | Value |
| --- | --- |
| Project name | `supabase-AutoLenis` |
| Project ref | `aieybibvewmvrubcpthm` |
| Region | `us-east-1` |
| Postgres | 17.x |
| API URL (`NEXT_PUBLIC_SUPABASE_URL`) | `https://aieybibvewmvrubcpthm.supabase.co` |
| Direct DB host | `db.aieybibvewmvrubcpthm.supabase.co` |
| Pooler host | `aws-0-us-east-1.pooler.supabase.com` |

The project ref and hosts are not secrets (they appear in every request URL).
The **database password**, **anon key**, **service-role key**, and **JWT secret**
are secrets — copy them from **Supabase Dashboard → Project Settings → API**
(keys) and **→ Database** (password / connection strings). Never commit them.

## Environment variables

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the values
below. Replace `[YOUR-PASSWORD]` with the database password; if it contains
special characters (`@ : / ? # [ ] & = + space` …), **percent-encode** them
(e.g. `@` → `%40`, `#` → `%23`, space → `%20`).

```dotenv
# ── Prisma / Postgres ────────────────────────────────────────────────────────
# DATABASE_URL: pooled (Supavisor transaction mode, port 6543) — app runtime.
DATABASE_URL="postgresql://postgres.aieybibvewmvrubcpthm:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# DIRECT_URL: non-pooled (session mode) — used by prisma migrate/validate/db push.
# Preferred in IPv4-only environments (Vercel, most CI): session pooler, port 5432.
DIRECT_URL="postgresql://postgres.aieybibvewmvrubcpthm:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

# ── Supabase client (@supabase/ssr, lib/supabase*.ts) ────────────────────────
NEXT_PUBLIC_SUPABASE_URL="https://aieybibvewmvrubcpthm.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon / publishable key from Dashboard → API>"
SUPABASE_SERVICE_ROLE_KEY="<service_role key from Dashboard → API>"
SUPABASE_JWT_SECRET="<JWT secret from Dashboard → API>"
```

### Which connection string goes where

- **`DATABASE_URL` — pooled, port `6543`, user `postgres.<ref>`.** Transaction-mode
  Supavisor pooler. Runtime path for the serverless app, where many short-lived
  connections need pooling. Keep `?pgbouncer=true` (disables prepared statements)
  and a small `connection_limit` per serverless instance.
- **`DIRECT_URL` — session mode, port `5432`, user `postgres.<ref>`.** Non-pooled
  session connection over the pooler host. `prisma migrate`/`validate`/`db push`
  need real session semantics and advisory locks, which the transaction pooler
  does not provide. The pooler host is IPv4-reachable, so it works from Vercel and
  CI; the legacy direct host `db.<ref>.supabase.co:5432` is IPv6-only unless the
  project has the IPv4 add-on.

```dotenv
# Legacy direct host alternative for DIRECT_URL (IPv6-only without IPv4 add-on):
# DIRECT_URL="postgresql://postgres:[YOUR-PASSWORD]@db.aieybibvewmvrubcpthm.supabase.co:5432/postgres"
```

## Verify the connection

From `frontend/` after setting `.env.local`:

```bash
pnpm exec prisma validate      # confirms DATABASE_URL + DIRECT_URL resolve
pnpm exec prisma migrate status # compares repo migrations against the live DB
```

`migrate status` is the drift check — it reports any migration present in
`prisma/migrations/` that has not been applied to the live database. Do **not**
run `prisma migrate deploy`/`db push` as part of connection setup; applying
migrations is a schema change that goes through the normal review pipeline
(`autolenis-supabase-postgres`).

## Deployment (Vercel / CI)

Set the same variables as **Environment Variables** in the Vercel project (and in
CI secrets), not in any committed file. Use the pooled `DATABASE_URL` for the
runtime; provide `DIRECT_URL` so build-time `prisma` steps can validate.

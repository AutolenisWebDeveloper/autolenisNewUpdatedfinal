---
name: autolenis-observability-sre
description: >-
  Owns AutoLenis observability and SRE — structured logging, Sentry error
  monitoring, correlation IDs, metrics/alerts, cron and background-job monitoring,
  dead-letter drain, webhook reconciliation, health checks, runbooks, and
  rollback. Use this skill when touching frontend/lib/logger.ts, lib/observability/,
  lib/services/monitoring/, instrumentation*.ts, app/api/cron/*, app/api/webhooks/*,
  the CronJobLog/HealthCheckLog/WebhookEvent models, or Inngest/QStash dispatch;
  when adding a background job, cron, or alert; or when a task mentions logging,
  Sentry, correlation ID, DLQ, reconciliation, health check, runbook, or rollback.
---

## Purpose & Authority

This skill governs how AutoLenis observes itself and stays operable: what gets
logged, how errors reach Sentry, how background jobs are monitored and retried,
how webhooks are reconciled, and how incidents are handled and rolled back. It
overrides generic "add a console.log" or "just retry it" advice. AutoLenis runs
money movement, legally-binding e-sign, and multi-stage deal state machines on
Vercel with Inngest/QStash background work; a silently-failed cron, an
unreconciled webhook, or an unmonitored job is a production incident waiting to
happen. Every background job is observable, retryable, and manually backfillable.

## When this skill activates

- `frontend/lib/logger.ts`, `frontend/lib/observability/` (`alert.ts`),
  `frontend/lib/services/monitoring/` (`cron-monitor.service.ts`,
  `health.service.ts`, `health-alert.service.ts`).
- `frontend/instrumentation.ts`, `frontend/instrumentation-client.ts` (Sentry).
- Anything under `app/api/cron/*` or `app/api/webhooks/*`.
- Background dispatch: `lib/inngest/` (`client.ts`, `functions.ts`,
  `idempotency.ts`), `lib/qstash/` (`dispatch.ts`, `receiver.ts`, `verify.ts`,
  `state.ts`, `notify.ts`), Vercel `after()`.
- Models `CronJobLog`, `HealthCheckLog`, `WebhookEvent`, `RateLimitEvent`.
- Keywords: logging, structured log, Sentry, correlation ID, metric, alert,
  cron, DLQ, dead-letter, reconciliation, health check, runbook, rollback, backfill.

## Architecture & key files

- **Logging:** `lib/logger.ts` — dependency-free, edge-safe. In production emits
  one JSON line per call (`{level,time,msg,args}`); error-level entries are
  forwarded to Sentry automatically via `forwardToSentry` (lazy `@sentry/nextjs`,
  no-op without a DSN). `LOG_LEVEL` controls threshold (`debug` in dev, `info` in
  prod). **Always use `logger`, never bare `console`**, so errors reach Sentry
  and logs stay queryable.
- **Sentry:** `instrumentation.ts` (`register()` gated on `SENTRY_DSN` /
  `NEXT_PUBLIC_SENTRY_DSN`; conservative `tracesSampleRate`, default 0.05;
  `onRequestError = Sentry.captureRequestError` for RSC/route/edge errors) and
  `instrumentation-client.ts`. Payment/webhook paths log via `logger`, which
  forwards to Sentry — no per-route wiring needed.
- **Alerting:** `lib/observability/alert.ts` — `pageOnCall()` and
  `notifyOncall()`.
- **Cron monitoring:** `lib/services/monitoring/cron-monitor.service.ts` —
  `startCronRun(cronName)`, `completeCronRun(logId, result)`,
  `failCronRun(logId, error)`, `getRecentCronLogs()`; persists `CronJobLog`
  (`cronName`, `status: CronJobStatus`, `duration` ms, `result`, `error`,
  `startedAt`, `completedAt`).
- **Health:** `health.service.ts` + `health-alert.service.ts`; `HealthCheckLog`
  (`status healthy|degraded|down`, `database`, `inventoryHealth`,
  `activeAuctions`, `pendingOFAC`, `alerts`). Endpoint: `app/api/cron/health-check`.
- **Crons (`app/api/cron/*`, ~45 jobs):** e.g. `auction-close`,
  `deposit-activation-reconcile`, `contract-shield`, `dlq-drain`,
  `vehicle-offer-expire`, `sla-check`, `prequal-sla-escalation`, `trust-check`,
  `morning-briefing`, `health-check`, plus the AMIPS/social family. Every cron
  authenticates via `CRON_AUTH_HEADER` / `CRON_AUTH_PREFIX + CRON_SECRET` or the
  `x-vercel-cron` header before doing work.
- **Dead-letter:** `app/api/cron/dlq-drain/route.ts` → `OperationsService`
  (`autoDrainDeadLetterJobs()`), covering both Inngest- and QStash-origin jobs
  with bounded per-row retries so a poison job can't hot-loop.
- **Webhooks:** `WebhookEvent` (`source stripe|docusign|microbilt`, `eventType`,
  `payload`, `processed`, `error`) is the reconciliation ledger.

## Core rules & invariants

1. **Log through `lib/logger`, never bare `console`.** Error-level logs must
   carry the `Error` object so Sentry captures the stack. Prefix messages with
   the subsystem, e.g. `logger.error("[dlq-drain] failed:", err)`.
2. **Structured, not string-soup.** Pass context as args (queryable JSON), not
   interpolated into the message. Never log secrets, full SSNs, card numbers, or
   credit-report contents.
3. **Correlation.** Carry a correlation/request id through a job's log lines and
   into Sentry context so one failure is traceable end-to-end.
4. **Every cron is monitored.** Wrap the body in
   `startCronRun` → `completeCronRun`/`failCronRun`; a run that throws must be
   recorded as failed in `CronJobLog`, not swallowed.
5. **Every cron authenticates.** Reject unless `x-vercel-cron === "1"` or the
   auth header matches `CRON_AUTH_PREFIX + CRON_SECRET` (401 otherwise).
6. **Background work is idempotent and bounded.** Inngest/QStash handlers dedup
   (`lib/inngest/idempotency.ts`, QStash `state`) and cap retries; failures land
   in the DLQ, not an infinite loop.
7. **Every background job has a manual backfill endpoint** so ops can re-run it
   without waiting for the schedule (platform standard).
8. **Webhooks are verified, idempotent, and reconciled.** Verify the signature,
   record to `WebhookEvent`, process once (`processed`), and have a reconciliation
   cron catch anything missed (e.g. `deposit-activation-reconcile`).
9. **Alert on what pages a human.** Use `pageOnCall`/`notifyOncall` for
   money/e-sign/OFAC/health-`down` conditions; don't page on routine noise.
10. **Log which provider/model fired** for AI/external calls (Groq model,
    ElevenLabs vs Polly, etc.) so degradation is visible.
11. **Health check reflects real system state** (`database`, `inventoryHealth`,
    `activeAuctions`, `pendingOFAC`) and escalates on `degraded`/`down`.

## Workflows

**Add a cron job**
1. `app/api/cron/<name>/route.ts`, `export const dynamic = "force-dynamic"`.
2. Authenticate (`CRON_AUTH_HEADER` / `x-vercel-cron`) → 401 on failure.
3. `const logId = await startCronRun("<name>")`; run work in try/catch.
4. Success → `completeCronRun(logId, result)`; failure → `failCronRun(logId,
   String(err))` + `logger.error("[<name>] failed:", err)`.
5. Register the schedule (Vercel cron config); provide a manual backfill trigger.

**Add async/background work**
1. Prefer `after()` for fire-and-forget on the request path; use Inngest/QStash
   for durable, retryable, scheduled work.
2. Make the handler idempotent (dedup key); bound retries; on exhaustion route to
   the DLQ (drained by `dlq-drain`).
3. Log provider/model and outcome; expose a manual re-emit path.

**Handle/reconcile a webhook**
1. Verify signature; on failure log + 401/400, do not process.
2. Upsert `WebhookEvent`; if already `processed`, no-op (idempotent replay).
3. Apply the state effect in a transaction; mark `processed` or record `error`.
4. Ensure a reconciliation cron re-checks provider state for missed events.

**Incident / rollback**
1. Triage via Sentry + `logger` JSON + `getRecentCronLogs()` + `HealthCheckLog`.
2. Contain: if AI-related, `AI_KILL_SWITCH="true"`; disable the failing cron/flag.
3. Roll back the Vercel deployment to the last healthy release.
4. Drain/replay affected jobs (`dlq-drain`) and run the relevant reconciliation
   cron. Confirm `health-check` returns `healthy`.

## Boundaries — do / never

**Do**
- Use `logger` with subsystem prefixes and structured args; carry a correlation id.
- Wrap every cron in `startCronRun`/`complete`/`fail` and authenticate it.
- Make background handlers idempotent, bounded, DLQ-backed, and backfillable.
- Verify + reconcile every webhook via `WebhookEvent`.
- Page a human only for real, actionable conditions; log provider/model.

**Never**
- Use bare `console.*` on a server path, or swallow an error silently.
- Log secrets/SSN/card/credit data.
- Ship a cron that isn't recorded in `CronJobLog` or isn't authenticated.
- Let a failed job retry unbounded or vanish without a DLQ entry.
- Process a webhook without signature verification or idempotency.
- Add background work with no manual backfill/re-run path.

## Best practices & examples

Monitored, authenticated cron:

```ts
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = req.headers.get(CRON_AUTH_HEADER);
  const ok = req.headers.get("x-vercel-cron") === "1"
    || auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!ok) return new NextResponse("Unauthorized", { status: 401 });

  const logId = await startCronRun("auction-close");
  try {
    const result = await closeExpiredAuctions();      // idempotent
    await completeCronRun(logId, result);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    logger.error("[auction-close] failed:", err);     // → Sentry via logger
    await failCronRun(logId, String(err));
    return NextResponse.json({ success: false, error: "CLOSE_FAILED" }, { status: 500 });
  }
}
```

Structured, secret-safe log:

```ts
logger.info("[stripe-webhook] deposit paid", { depositId, eventId, cents }); // no PAN/PII
```

## Acceptance criteria

- [ ] All server logging goes through `lib/logger` with subsystem prefixes and
      structured args; error logs pass the `Error` so Sentry gets the stack.
- [ ] No secrets/SSN/card/credit data in logs; a correlation id ties a job's
      lines together.
- [ ] Every new cron authenticates and is wrapped in
      `startCronRun`/`completeCronRun`/`failCronRun` (`CronJobLog` recorded).
- [ ] Background handlers are idempotent, retry-bounded, DLQ-backed, and have a
      manual backfill/re-run path.
- [ ] Webhooks verify signatures, dedup via `WebhookEvent`, and have a
      reconciliation cron.
- [ ] Provider/model is logged for AI/external calls; alerts fire only on
      actionable conditions.
- [ ] `health-check` reflects real state and escalates on degraded/down; a
      rollback path is understood for the change.

## Cross-skill links

- `autolenis-payments-and-ledger` — Stripe webhook verification/idempotency and
  reconciliation crons.
- `autolenis-ai-safety-and-orchestration` — kill switch, provider/model logging.
- `autolenis-communications-consent` — SMS/email send logs and delivery status.
- `autolenis-auth-security-privacy` — cron/webhook auth, rate-limit events, PII
  handling in logs.
- `autolenis-testing-quality-gates` — webhook idempotency + cron failure tests.
- `autolenis-supabase-postgres` — `CronJobLog`/`HealthCheckLog`/`WebhookEvent`
  schema and safe backfills.
- `autolenis-system-architecture` — Inngest/QStash/`after()` background model.

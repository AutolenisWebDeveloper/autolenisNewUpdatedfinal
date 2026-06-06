// lib/services/email/compliance-send.ts
// Compliance-critical send wrapper with retry + alerting (P0-4).
//
// FCRA § 615 adverse-action delivery is a legal obligation, so a transient
// Resend outage must not silently drop the notice. complianceSend retries the
// send on a FAILED outcome with exponential backoff and, if every attempt
// fails, escalates by emailing the compliance/ops inbox. It NEVER reports a
// send as delivered unless the underlying verified outcome is "SENT" (or a
// prior verified "SENT" is found via idempotency → "DUPLICATE").
//
// Escalation channel note: the Notification model in this codebase targets
// buyers/dealers/affiliates only (no adminId), so admin escalation is done via
// the existing email-to-ops pattern (COMPLIANCE_ALERT_EMAIL, falling back to
// ADMIN_NOTIFICATION_EMAIL) rather than an in-app admin notification.

import {
  sendAdverseActionEmail,
  sendInternalAlertEmail,
  type EmailSendOutcome,
} from "./resend.service";

type AdverseActionParams = Parameters<typeof sendAdverseActionEmail>[0];

export interface ComplianceSendDeps {
  /** The underlying compliance-critical send. */
  send: (params: AdverseActionParams) => Promise<EmailSendOutcome>;
  /** Sleep between retries — injected as a no-op in tests. */
  sleep: (ms: number) => Promise<void>;
  /** Best-effort escalation email sender. */
  alertSend: (params: {
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
  }) => Promise<unknown>;
  /** Backoff schedule. Length === max number of retries after the first try. */
  retryDelaysMs: number[];
  /** Where escalation emails go; null disables the email escalation. */
  alertEmail: string | null;
}

// Backoff kept short enough to complete inside a serverless function budget when
// invoked inline on the buyer prequal path. (Dispatch suggested 8s/16s/32s; that
// 56s total risks exceeding the function timeout when run synchronously, so the
// schedule is compressed while preserving three retries.)
const DEFAULT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAlertEmail(): string | null {
  return (
    process.env.COMPLIANCE_ALERT_EMAIL ??
    process.env.ADMIN_NOTIFICATION_EMAIL ??
    null
  );
}

/**
 * Send a compliance-critical (FCRA) email with retry + escalation.
 * Returns the FINAL verified outcome. On SENT/DUPLICATE/DEV_SKIPPED it returns
 * immediately (no escalation). On exhausted FAILED it escalates, then returns
 * the failed outcome so the caller still writes its own ADVERSE_ACTION_NOTICE_*
 * compliance event from the true outcome.
 */
export async function complianceSend(
  params: AdverseActionParams & { buyerId?: string },
  depsOverride?: Partial<ComplianceSendDeps>,
): Promise<EmailSendOutcome> {
  const deps: ComplianceSendDeps = {
    send: sendAdverseActionEmail,
    sleep: defaultSleep,
    alertSend: sendInternalAlertEmail,
    retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
    alertEmail: resolveAlertEmail(),
    ...depsOverride,
  };

  let last: EmailSendOutcome | null = null;
  for (let attempt = 0; attempt <= deps.retryDelaysMs.length; attempt++) {
    last = await deps.send(params);
    // SENT = delivered; DUPLICATE = already verified-sent earlier; DEV_SKIPPED =
    // no API key configured (dev) — none of these warrant a retry or alert.
    if (
      last.outcome === "SENT" ||
      last.outcome === "DUPLICATE" ||
      last.outcome === "DEV_SKIPPED"
    ) {
      return last;
    }
    // FAILED — back off and retry unless this was the last attempt.
    if (attempt < deps.retryDelaysMs.length) {
      await deps.sleep(deps.retryDelaysMs[attempt]);
    }
  }

  await raiseComplianceAlert(params, last as EmailSendOutcome, deps);
  return last as EmailSendOutcome;
}

async function raiseComplianceAlert(
  params: AdverseActionParams & { buyerId?: string },
  finalOutcome: EmailSendOutcome,
  deps: ComplianceSendDeps,
): Promise<void> {
  if (!deps.alertEmail) {
    console.error(
      "[compliance-send] FCRA adverse-action send failed and no " +
        "COMPLIANCE_ALERT_EMAIL/ADMIN_NOTIFICATION_EMAIL is configured. " +
        `Recipient: ${params.to}, prequal: ${params.prequalApplicationId ?? "n/a"}.`,
    );
    return;
  }
  try {
    await deps.alertSend({
      to: deps.alertEmail,
      subject: "[ALERT] FCRA adverse-action email failed to send",
      idempotencyKey: `compliance-alert-${params.prequalApplicationId ?? params.to}-${Date.now()}`,
      html:
        `<p>An FCRA § 615 adverse-action notice failed to deliver after retries.</p>` +
        `<p>Recipient: <code>${params.to}</code></p>` +
        `<p>Buyer: <code>${params.buyerId ?? "n/a"}</code></p>` +
        `<p>Prequal application: <code>${params.prequalApplicationId ?? "n/a"}</code></p>` +
        `<p>Final outcome: <code>${finalOutcome.outcome}</code></p>` +
        `<p>Investigate immediately — adverse-action delivery is a legal ` +
        `obligation under FCRA § 615.</p>`,
    });
  } catch (alertErr) {
    // The escalation email itself failed — there is nothing left to fall back
    // to, so log loudly for the on-call operator.
    console.error(
      "[compliance-send] CRITICAL: escalation email ALSO failed:",
      alertErr,
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { loadExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";
import { sendCustomAdminEmail } from "@/lib/services/email/resend.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;color:#64748B;font-size:13px">${label}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0F172A;font-size:13px">${value}</td></tr>`;
}

// Weekly — email an executive market-intelligence digest to operations.
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    return NextResponse.json(
      { success: false, error: "ADMIN_NOTIFICATION_EMAIL not configured" },
      { status: 200 },
    );
  }

  const run = await withCronRun("amips-digest", async () => {
    const intel = await loadExecutiveIntelligence();
    const weekKey = new Date().toISOString().slice(0, 10);
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

    const topOpps = intel.opportunities
      .filter((o) => o.opportunityScore > 0)
      .slice(0, 5)
      .map(
        (o, i) =>
          `<li style="margin:0 0 6px;color:#1f2937;font-size:13px"><b>${i + 1}. ${o.metro}, ${o.state}</b> — opportunity ${o.opportunityScore}/100 (${o.driver})</li>`,
      )
      .join("");

    const risks = intel.risks
      .slice(0, 5)
      .map(
        (r) =>
          `<li style="margin:0 0 6px;color:#1f2937;font-size:13px"><b>${r.severity.toUpperCase()}</b> · ${r.title}</li>`,
      )
      .join("");

    const revenue = intel.headline.find((h) => h.key === "revenue")?.value ?? "—";

    const body = `
      <div style="text-align:center;border-bottom:2px solid #0B5FD1;padding-bottom:16px;margin-bottom:20px">
        <p style="margin:0;color:#94A3B8;font-size:11px;letter-spacing:1px;text-transform:uppercase">AutoLenis Market Intelligence</p>
        <h1 style="margin:6px 0 0;font-size:22px;color:#0F172A">Weekly Executive Digest</h1>
        <p style="margin:4px 0 0;color:#64748B;font-size:12px">Week of ${weekKey}</p>
      </div>

      <div style="text-align:center;margin-bottom:20px">
        <span style="font-size:40px;font-weight:800;color:#0B5FD1">${intel.health.score}</span>
        <span style="font-size:16px;color:#94A3B8">/100</span>
        <p style="margin:2px 0 0;color:#0F172A;font-weight:600;font-size:14px">National Market Health — ${intel.health.grade}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        ${intel.headline.map((h) => row(h.label, h.value)).join("")}
        ${row("Indexation Rate", `${Math.round(intel.content.indexationRate * 100)}%`)}
        ${row("Revenue Run-Rate", revenue)}
      </table>

      <h2 style="font-size:14px;color:#0F172A;margin:24px 0 8px">Top Market Opportunities</h2>
      <ol style="margin:0;padding-left:18px">${topOpps || '<li style="color:#94A3B8;font-size:13px">No scored opportunities yet</li>'}</ol>

      <h2 style="font-size:14px;color:#0F172A;margin:24px 0 8px">Risk Watch</h2>
      <ul style="margin:0;padding-left:18px">${risks || '<li style="color:#059669;font-size:13px">All clear — no active risks</li>'}</ul>

      <div style="text-align:center;margin:28px 0 4px">
        <a href="${appUrl}/admin/amips" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Open Intelligence Center &rarr;</a>
      </div>
    `;

    const result = await sendCustomAdminEmail({
      to,
      subject: `AMIPS Weekly Digest — Health ${intel.health.score}/100 (${intel.health.grade})`,
      body,
      idempotencyKey: `amips-digest-${weekKey}`,
    });

    return { weekOf: weekKey, sent: result.sent, healthScore: intel.health.score };
  });
  if (!run.ok) {
    return NextResponse.json(
      { success: false, error: (run.error as Error).message },
      { status: 200 },
    );
  }
  return NextResponse.json({
    success: true,
    data: run.result,
  });
}

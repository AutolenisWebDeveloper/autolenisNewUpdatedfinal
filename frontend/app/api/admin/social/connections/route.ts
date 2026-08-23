// GET /api/admin/social/connections
// Provider connection status for the dashboard Settings tab. "Connected" is
// derived purely from env-var presence — this endpoint never makes live API
// calls so it is fast and side-effect free.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { AUTOMATION_MODE } from "@/lib/social/config";

export interface ConnectionsResponse {
  meta: { connected: boolean };
  tiktok: { connected: boolean };
  linkedin: { connected: boolean; pageId: string };
  runway: { connected: boolean };
  automationMode: string;
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const data: ConnectionsResponse = {
    meta: {
      connected: Boolean(process.env.META_ACCESS_TOKEN?.trim()),
    },
    tiktok: {
      connected: Boolean(process.env.TIKTOK_ACCESS_TOKEN?.trim()),
    },
    linkedin: {
      connected: Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ACCESS_TOKEN.trim()),
      pageId: process.env.LINKEDIN_COMPANY_PAGE_ID ?? "",
    },
    runway: {
      connected: Boolean(process.env.RUNWAY_API_KEY && process.env.RUNWAY_API_KEY.trim()),
    },
    automationMode: AUTOMATION_MODE,
  };

  return adminSuccess(data);
}

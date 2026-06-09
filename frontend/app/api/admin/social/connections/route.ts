// GET /api/admin/social/connections
// Provider connection status for the dashboard Settings tab. "Connected" is
// derived purely from env-var presence — this endpoint never makes live API
// calls so it is fast and side-effect free.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { AUTOMATION_MODE } from "@/lib/social/config";

export interface ConnectionsResponse {
  buffer: { connected: boolean; channelCount: number };
  linkedin: { connected: boolean; pageId: string };
  higgsfield: { connected: boolean };
  automationMode: string;
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const bufferChannels = [
    process.env.BUFFER_PROFILE_FACEBOOK,
    process.env.BUFFER_PROFILE_INSTAGRAM,
    process.env.BUFFER_PROFILE_TIKTOK,
    process.env.BUFFER_PROFILE_YOUTUBE,
    process.env.BUFFER_PROFILE_LINKEDIN,
  ].filter((v) => Boolean(v && v.trim()));

  const data: ConnectionsResponse = {
    buffer: {
      connected: Boolean(process.env.BUFFER_API_KEY && process.env.BUFFER_API_KEY.trim()),
      channelCount: bufferChannels.length,
    },
    linkedin: {
      connected: Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ACCESS_TOKEN.trim()),
      pageId: process.env.LINKEDIN_COMPANY_PAGE_ID ?? "",
    },
    higgsfield: {
      connected: Boolean(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_KEY.trim()),
    },
    automationMode: AUTOMATION_MODE,
  };

  return adminSuccess(data);
}

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getAllVerses, upsertVerse } from "@/lib/services/faith/faith.service";
import { z } from "zod";

const schema = z.object({ reference: z.string(), text: z.string(), book: z.string(), chapter: z.number().int(), verse: z.number().int() });

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "0");
  const verses = await getAllVerses(50, page);
  return adminSuccess({ verses, page });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const verse = await upsertVerse(parsed.data.reference, parsed.data.text, parsed.data.book, parsed.data.chapter, parsed.data.verse);
  return adminSuccess({ verse }, 201);
}

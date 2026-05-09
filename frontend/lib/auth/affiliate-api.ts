import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
export function errorResponse(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message }, correlationId: crypto.randomUUID() }, { status });
}

export async function getRequestAffiliate(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const affiliate = await prisma.affiliate.findFirst({
    where: { user: { supabaseId: user.id } },
    include: { user: true },
  });

  if (!affiliate) return null;

  if (affiliate.status === "SUSPENDED" || affiliate.status === "REJECTED") {
    return null;
  }

  return affiliate;
}

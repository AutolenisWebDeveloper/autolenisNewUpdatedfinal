// GET /api/admin/dealers/applications — list dealer applications

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "PENDING";

  const apps = await prisma.dealerApplication.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    success: true,
    data: apps.map(a => ({
      id: a.id,
      dealershipName: a.dealershipName,
      dealershipType: a.dealershipType,
      city: a.city,
      state: a.state,
      licenseNumber: a.licenseNumber,
      contactName: a.contactName,
      contactEmail: a.contactEmail,
      contactPhone: a.contactPhone,
      annualVolume: a.annualVolume,
      notes: a.notes,
      status: a.status,
      rejectReason: a.rejectReason,
      dealerId: a.dealerId,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

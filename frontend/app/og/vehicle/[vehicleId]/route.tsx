import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

// Note: edge runtime is incompatible with the Node-based Prisma client used in
// this project, so we run on the standard Node.js runtime.
export const runtime = "nodejs";
export const revalidate = 3600;

interface Params {
  params: Promise<{ vehicleId: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { vehicleId } = await params;

  const vehicle = await prisma.inventoryItem.findUnique({
    where: { id: vehicleId, isActive: true },
    select: { year: true, make: true, model: true, trim: true, priceCents: true },
  }).catch(() => null);

  const title = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`
    : "Find Your Best Deal";
  const price = vehicle ? `$${(vehicle.priceCents / 100).toLocaleString("en-US")}` : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "linear-gradient(135deg, #0B5FD1 0%, #1E3A8A 100%)",
          display: "flex",
          flexDirection: "column",
          padding: "60px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* AutoLenis logo area */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "auto" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "10px",
              background: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: "20px", fontWeight: 900, color: "#0B5FD1" }}>A</span>
          </div>
          <span style={{ color: "white", fontWeight: 700, fontSize: "22px" }}>AutoLenis</span>
          <span
            style={{
              marginLeft: "12px",
              background: "rgba(255,255,255,0.15)",
              borderRadius: "20px",
              padding: "4px 14px",
              color: "white",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            Dealers Compete For You
          </span>
        </div>

        {/* Vehicle info */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "18px", margin: 0 }}>
            {vehicle ? "Available Now" : "Verified Inventory"}
          </p>
          <h1
            style={{
              color: "white",
              fontSize: "56px",
              fontWeight: 900,
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {title}
          </h1>
          {price && (
            <p style={{ color: "#60A5FA", fontSize: "36px", fontWeight: 800, margin: 0 }}>
              {price}
            </p>
          )}
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "18px", margin: 0 }}>
            Soft-pull prequalification · $99 refundable if no offer · 48-hour auction
          </p>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

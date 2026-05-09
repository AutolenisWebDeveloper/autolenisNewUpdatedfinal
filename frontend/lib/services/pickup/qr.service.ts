// lib/services/pickup/qr.service.ts — QR generation wrapper
import QRCode from "qrcode";

export async function generatePickupQr(dealId: string, pickupId: string): Promise<{ data: string; image: string }> {
  const payload = JSON.stringify({ type: "autolenis_pickup", dealId, pickupId, issuedAt: new Date().toISOString(), nonce: Math.random().toString(36).slice(2) });
  const image = await QRCode.toDataURL(payload, { width: 300 });
  return { data: payload, image };
}

export async function validateQrPayload(qrData: string, dealId: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(qrData) as { type: string; dealId: string };
    return parsed.type === "autolenis_pickup" && parsed.dealId === dealId;
  } catch { return false; }
}

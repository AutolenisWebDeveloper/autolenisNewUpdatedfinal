// POST /api/admin/inventory/upload-image
// Uploads a vehicle image to Supabase Storage (vehicle-images bucket).
// Falls back to returning a data URL if storage is not configured.

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "vehicle-images";

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const vehicleId = formData.get("vehicleId") as string | null;

  if (!file) return NextResponse.json({ error: { code: "NO_FILE", message: "No file provided" } }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    // Fallback: return placeholder URL
    return NextResponse.json({
      success: true,
      url: `/api/placeholder-image?v=${Date.now()}`,
      isFallback: true,
    });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);

    // Ensure bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find(b => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: true });
    }

    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${vehicleId ?? "temp"}/${Date.now()}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ success: true, url: publicData.publicUrl, path });
  } catch (err: unknown) {
    // Fallback if storage fails
    return NextResponse.json({
      success: true,
      url: `/api/placeholder-image?v=${Date.now()}`,
      isFallback: true,
      storageError: err instanceof Error ? err.message : "Storage unavailable",
    });
  }
}

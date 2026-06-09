// Creates the Supabase storage buckets the social media engine needs.
//
// Run once per environment: pnpm setup:storage
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.

import { getServiceSupabase } from "@/lib/supabase-service";

async function setupBuckets() {
  const supabase = getServiceSupabase();

  // Create social-media-assets bucket (images + video for generated posts).
  const { error } = await supabase.storage.createBucket("social-media-assets", {
    public: true,
    fileSizeLimit: 52428800, // 50MB
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/quicktime",
    ],
  });

  if (error && !error.message.includes("already exists")) {
    console.error("Failed to create bucket:", error);
  } else {
    console.log("✅ social-media-assets bucket ready");
  }
}

setupBuckets()
  .catch(console.error)
  .finally(() => process.exit());

-- AutoLenis Social Engine — Social Media Assets Storage Bucket
--
-- Creates the public `social-media-assets` bucket that the Social Engine
-- uploads generated/uploaded post images and rendered videos to. Without it,
-- every upload (manual "Upload Image", AI image generation, video render
-- re-hosting) fails with "Bucket not found" at
-- lib/social/image-generation.service.ts.
--
-- This mirrors scripts/setup-storage-buckets.ts (pnpm setup:storage) so the
-- bucket is provisioned reproducibly per environment via the manual SQL path.
--
-- Idempotent: re-running is safe. NOTE: Postgres does not support
-- `CREATE POLICY IF NOT EXISTS`, so we DROP-then-CREATE the policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'social-media-assets',
  'social-media-assets',
  true,
  52428800, -- 50MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];

DROP POLICY IF EXISTS "Public read access for social-media-assets" ON storage.objects;
CREATE POLICY "Public read access for social-media-assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'social-media-assets');

DROP POLICY IF EXISTS "Service role write access for social-media-assets" ON storage.objects;
CREATE POLICY "Service role write access for social-media-assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'social-media-assets');

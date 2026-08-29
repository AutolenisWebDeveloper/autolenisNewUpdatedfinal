-- AutoLenis Voice Upgrade — Zura Audio Storage Bucket
--
-- Creates the public `zura-audio` bucket that the ElevenLabs TTS service
-- uploads synthesized MP3s to, and the RLS policies that allow public reads
-- (Twilio <Play> fetches the file) and service-role writes (the upload).
--
-- Idempotent: re-running is safe. NOTE: Postgres does not support
-- `CREATE POLICY IF NOT EXISTS`, so we DROP-then-CREATE the policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'zura-audio',
  'zura-audio',
  true,
  10485760,
  ARRAY['audio/mpeg', 'audio/mp3']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['audio/mpeg', 'audio/mp3'];

DROP POLICY IF EXISTS "Public read access for zura-audio" ON storage.objects;
CREATE POLICY "Public read access for zura-audio"
ON storage.objects FOR SELECT
USING (bucket_id = 'zura-audio');

DROP POLICY IF EXISTS "Service role write access for zura-audio" ON storage.objects;
CREATE POLICY "Service role write access for zura-audio"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'zura-audio');

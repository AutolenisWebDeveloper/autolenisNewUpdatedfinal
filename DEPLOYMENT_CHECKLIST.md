# Deployment Checklist

## Supabase Storage Buckets

Ensure the following storage buckets exist in Supabase before deploying:

- [ ] `buyer-documents` (private, 10MB, PDF/JPG/PNG/WEBP)
- [ ] `dealer-contracts` (private, 20MB, PDF only)
- [ ] `dealer-documents` (private, 20MB, PDF/JPG/PNG/WEBP)

## Affiliate Onboarding
- [ ] Run migration: pnpm prisma migrate deploy (20260801000005_affiliate_onboarding)
- [ ] Supabase Storage: create bucket "affiliate-documents" (private, 10MB limit, PDF/JPG/PNG/WEBP)
- [ ] RLS: affiliate can INSERT own files; admin service role can SELECT all
- [ ] Admin notification email configured for AFFILIATE_ONBOARDING_SUBMITTED webhook

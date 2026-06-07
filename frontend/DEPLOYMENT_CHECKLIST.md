# AutoLenis Deployment Checklist

## Before every production deployment

### Database
- [ ] Run `pnpm prisma migrate deploy` against production database
- [ ] Verify migration applied: `pnpm prisma db pull` and confirm schema matches

### Environment Variables (Vercel → Project Settings → Environment Variables)
- [ ] STRIPE_SECRET_KEY — production key (not test key)
- [ ] MFA_ENCRYPTION_KEY — 32-byte base64 key (`openssl rand -base64 32`)
- [ ] SUPABASE_SERVICE_ROLE_KEY — from Supabase project settings → API
- [ ] All other required vars from .env.example

### Supabase Storage Buckets (one-time setup per environment)
- [ ] `prequal-letters` bucket — create in Supabase dashboard → Storage
  - Access: private (not public — admins access via service role key)
  - RLS: authenticated buyers can INSERT their own files; service role can SELECT all
  - File size limit: 10MB
  - Allowed MIME types: application/pdf, image/jpeg, image/png, image/webp

- [ ] `affiliate-documents` bucket — create in Supabase dashboard → Storage
  - Access: **private** (not public — files served only via signed URLs with expiry)
  - RLS: authenticated affiliates can INSERT their own files (path starts with their userId); service role can SELECT all
  - File size limit: 10MB
  - Allowed MIME types: application/pdf, image/jpeg, image/png

- [ ] `insurance-proofs` bucket — create in Supabase dashboard → Storage
  - Access: private (not public — admins access via service role key)
  - RLS: authenticated buyers can INSERT their own files (path starts with their buyerId); service role can SELECT all
  - File size limit: 10MB
  - Allowed MIME types: application/pdf, image/jpeg, image/png

- [ ] `buyer-documents` bucket — create in Supabase dashboard → Storage
  - Access: public
  - RLS: authenticated buyers can INSERT their own files (path starts with their buyerId); service role can SELECT all
  - File size limit: 10MB
  - Allowed MIME types: application/pdf, image/jpeg, image/png, image/webp

- [ ] `legal-documents` bucket — create in Supabase dashboard → Storage → New bucket
  - Name: `legal-documents`
  - Public access: OFF (private)
  - No RLS policies required (service role key governs all access through the API layer)
  - Path convention: dealer-agreements/{dealerId}/{signatureId}.pdf
  - Allowed MIME type: application/pdf
  - File size limit: 5MB
  - pdfkit installed: pnpm add pdfkit && pnpm add -D @types/pdfkit

### Stripe (one-time per environment)
- [ ] Webhook endpoint registered at: `https://autolenis.com/api/webhooks/stripe`
- [ ] Webhook events enabled: payment_intent.succeeded, checkout.session.completed,
      payment_intent.payment_failed, charge.refunded

### DocuSign (one-time per environment)
- [ ] DOCUSIGN_ENV=production
- [ ] DOCUSIGN_AUTH_SERVER=account.docusign.com
- [ ] DOCUSIGN_OAUTH_BASE_URL=https://account.docusign.com
- [ ] DOCUSIGN_BASE_URL=https://na4.docusign.net/restapi (verify account region — may be na3 or eu)
- [ ] DOCUSIGN_INTEGRATION_KEY=<production key UUID>
- [ ] DOCUSIGN_USER_ID=<production user UUID>
- [ ] DOCUSIGN_ACCOUNT_ID=<production account ID>
- [ ] DOCUSIGN_PRIVATE_KEY_BASE64=<base64 of production RSA private key>
- [ ] DOCUSIGN_DEALER_TEMPLATE_ID=<production template UUID>
- [ ] DOCUSIGN_RETURN_URL=https://autolenis.com/buyer/esign?signed=true
- [ ] DOCUSIGN_WEBHOOK_SECRET=<production webhook HMAC secret>
- [ ] DocuSign webhook endpoint configured: https://autolenis.com/api/webhooks/docusign

### MicroBilt (one-time per environment)
- [ ] Credentials promoted from sandbox to production

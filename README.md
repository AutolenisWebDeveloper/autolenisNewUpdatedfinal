# AutoLenis
**Premium Automotive Concierge and Reverse-Auction Platform**
AutoLenis eliminates dealership negotiation. Buyers submit a vehicle request, pass
a soft-pull prequalification, build a shortlist, pay a $99 activation deposit, and
enter a private 48-hour reverse auction where up to 8 vetted dealers compete for
their business. The Best Price Engine surfaces three ranked options — Best for
Cash, Best Monthly, Best Overall Value — and the buyer selects one. AutoLenis
then guides the buyer through financing, insurance, Contract Shield document
review, DocuSign e-signature, and QR-code vehicle pickup.
**Production Domain:** [autolenis.com](https://autolenis.com)
**Vercel Preview:** [autolenis.vercel.app](https://autolenis.vercel.app)
---
## Platform Overview
AutoLenis operates across five surfaces:
| Portal | Users | Purpose |
|---|---|---|
| Public Website | All visitors | Acquisition, education, dealer recruitment, affiliate
entry |
| Buyer Portal | Buyers | Full vehicle purchase lifecycle |
| Dealer Portal | Dealers | Inventory, bidding, contracts, delivery |
| Affiliate Portal | Affiliates | Referral tracking, commissions, payouts |
| Admin Console | Admins | Operations, compliance, oversight |
---
## Tech Stack
```text
Next.js 16 App Router, TypeScript strict mode
Prisma 5 ORM — 136 models, 70 enums
Supabase PostgreSQL, Auth, Storage
Stripe Payments, embedded checkout, webhooks
DocuSign E-signature
MicroBilt iPredict Prequalification, soft credit pull
Resend Transactional email
Groq API AI Concierge
Tailwind CSS v4 Styling
shadcn/ui Component library
Recharts Charts and analytics
Vercel Hosting, cron jobs
⸻
Platform Scale
Metric Count
Pages / Routes 301
API Routes 125+
Service Files 106
Prisma Models136
Prisma Enums 70
Cron Routes 19
NKJV Faith Verses 471
Migrations Applied 7
⸻
Buyer Journey
Signup → Onboarding → Prequalification
→ Vehicle Search → Shortlist
→ $99 Activation Deposit
→ 48-Hour Reverse Auction
→ Best Price Engine
→ Deal Selection
→ Financing Choice
→ AutoLenis Fee
→ Insurance Completion
→ Contract Shield Review
→ DocuSign E-Signature
→ QR-Code Vehicle Pickup
→ Complete
⸻
Pricing Model
Standard Plan — Free
* No concierge fee
* $99 Auction Access Deposit required to activate auction
* Deposit credited toward vehicle purchase at closing
Premium Plan — $499
* $99 Auction Access Deposit required to activate auction
* Deposit credited toward $499 concierge fee
* $400 net due at closing after deposit credit
* Includes dedicated buying specialist, financing guidance, priority dealer
handling, contract review coordination, and free home delivery
⸻
Key Platform Constants
DEPOSIT_AMOUNT_CENTS = 9900
PREMIUM_FEE_CENTS = 49900
PREMIUM_FEE_REMAINING_CENTS = 40000
STANDARD_FEE_CENTS = 0
AUCTION_DURATION_HOURS = 48
MAX_SHORTLIST_ITEMS = 5
COMMISSION_RATES = {
LEVEL_1: 0.15,
LEVEL_2: 0.03,
LEVEL_3: 0.02
}
Contract Shield thresholds:
PASS ≥ 85
WARNING 70–84
FAIL ≤ 69
⸻
Required Environment Variables
Create a .env.local file in /frontend/.
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
DIRECT_URL=
# Auth
JWT_SECRET=
CSRF_SECRET=
PREQUAL_ENCRYPTION_KEY=
CRON_SECRET=
EMAIL_UNSUBSCRIBE_SECRET=
# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
# DocuSign
DOCUSIGN_CLIENT_ID=
DOCUSIGN_CLIENT_SECRET=
DOCUSIGN_PRIVATE_KEY_BASE64=
DOCUSIGN_ACCOUNT_ID=
# MicroBilt
MICROBILT_CLIENT_ID=
MICROBILT_CLIENT_SECRET=
MICROBILT_IPREDICT_BASE_URL=
# Resend
RESEND_API_KEY=
# Groq
GROQ_API_KEY=
# Platform
NEXT_PUBLIC_APP_URL=https://autolenis.com
MAINTENANCE_MODE=false
CURRENT_TERMS_VERSION=2026-04-01
NODE_ENV=production
⸻
Local Development
Prerequisites:
* Node.js 18+
* pnpm
* Supabase project
* PostgreSQL connection string
cd frontend
pnpm install
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm dev
The app runs at:
http://localhost:3000
⸻
Database
AutoLenis uses Prisma with Supabase PostgreSQL.
cd frontend
# Apply migrations
pnpm prisma migrate deploy
# Generate Prisma client
pnpm prisma generate
# Local inspection only
pnpm prisma studio
Critical rule: Never use prisma db push in production. Always use prisma migrate
deploy.
⸻
Build and Quality
cd frontend
pnpm typecheck
pnpm lint
pnpm build
pnpm start
All three validation commands must pass before deployment:
pnpm typecheck && pnpm lint && pnpm build
⸻
Cron Jobs
Cron jobs are registered in frontend/vercel.json. Each cron route must verify:
Authorization: Bearer ${CRON_SECRET}
Route Schedule Purpose
/api/cron/auction-close Every 5 min Close expired auctions
/api/cron/holdsEvery 10 min Refund deposits with no offers
/api/cron/affiliates Hourly Approve pending commissions
/api/cron/contract-shieldHourly Batch contract scanning
/api/cron/sessions Every 6h Clean expired sessions
/api/cron/prequal-ibv-reminders 8am daily IBV reminder emails
/api/cron/prequal-stale-cleanup 2am dailyRemove stale prequal sessions
/api/cron/prequal-sla-escalation 9am dailyEscalate prequalification SLA
breaches
/api/cron/prequal-message-delivery Every 4h Deliver queued prequal
messages
/api/cron/prequal-purge 3am dailyPurge expired prequal data
/api/cron/inventory-sync-full Every 6h Full inventory sync
/api/cron/inventory-sync-priority Hourly Priority inventory sync
/api/cron/inventory-stale-sweep Every 30 min Deactivate stale listings
/api/cron/analytics-snapshot 1am daily Daily analytics snapshot
/api/cron/health-check Every 5 min Platform health monitoring
/api/cron/trust-check Hourly Anti-circumvention monitoring
/api/cron/workflow-automation Every 5 min Nudge engine and risk updates
/api/cron/faith-verse-rotation Monday 12:01 AM CST Rotate faith verses
/api/cron/affiliate-digest Monday 2pm UTC Weekly affiliate digest email
⸻
Production Deployment
Deployments are triggered automatically on push to the main branch through
Vercel.
Manual production deployment:
cd frontend
vercel --prod
Vercel configuration:
Setting Value
Root Directory frontend
Framework Preset Next.js
Install Command pnpm install
Build Command pnpm build
Output Directory .next
⸻
Manual Deployment Gates
GateStatus Action Required
DNS cutover COMPLETE autolenis.com points to Vercel.
Stripe webhook CONFIGURED — VALIDATION PENDINGVerify live delivery at
https://autolenis.com/api/webhooks/stripe and confirm
STRIPE_WEBHOOK_SECRET is set in Vercel.
DocuSign production credentials OPEN Promote sandbox credentials to
production and update Vercel env vars.
MicroBilt production credentials OPEN Promote sandbox credentials to
production and update Vercel env vars.
⸻
Architecture
Browser
→ Next.js App Router
→ proxy.ts
→ API Route Handlers
→ Service Layer
→ Prisma ORM
→ Supabase PostgreSQL
→ External APIs
External APIs include:
Stripe
DocuSign
MicroBilt iPredict
Resend
Groq
⸻
Middleware
proxy.ts is the only active middleware file.
Dead files must not be referenced:
middleware.ts.bak
middleware.ts.txt
⸻
AI Concierge
AutoLenis uses Groq API only.
Approved models:
llama-3.3-70b-versatile
mixtral-8x7b-32768
Do not use OpenAI, Anthropic, Gemini, Cohere, or other AI providers in
orchestration layers.
⸻
Dealer Accounts
Dealer accounts use a single account model and one role:
DEALER
No dealer sub-roles.
No dealer team management.
No DealerTeamMember model.
⸻
Security
* JWT authentication using jose
* 7-day standard TTL
* 30-day remember-me TTL
* CSRF double-submit cookie via proxy.ts
* Admin MFA required through TOTP
* SSN and sensitive prequalification data encrypted using AES-256-GCM
* OFAC alerts auto-escalate to manual review
* Passwords hashed with bcrypt cost factor 12 or higher
* Stripe webhooks require signature verification
* Cron endpoints require bearer authorization
* Supabase service role key is server-only
⸻
Compliance
Area Requirement
FCRA Adverse action language required on every declined prequalification
result
OFAC Any OFAC alert must route to manual admin review
CAN-SPAM Unsubscribe link required in every email
TCPA Consent required on all phone-number collection forms
Refinance AutoLenis is a lead provider only, not a lender or broker
Insurance Mock Data Mock insurance data must never be served in production
Refinance partner:
OpenRoad Lending
⸻
Faith Layer
AutoLenis includes an optional Faith & Encouragement Brand Layer.
* 471 NKJV verses seeded
* Faith content rotates across approved public pages
* Born-again invitation appears only on /hope
* Admin CMS available at /admin/faith-content
* Faith modules must fail gracefully if verse APIs fail
⸻
Brand Colors
--color-primary: #643293;
--color-secondary: #50D14E;
--color-accent-blue: #53C8E7;
--color-deep-blue: #2667BF;
⸻
Logo
Use the shared logo component everywhere:
import { AutoLenisLogo } from '@/components/shared/AutoLenisLogo'
Never hardcode logo image tags.
⸻
Development Rules
* Business logic belongs in frontend/lib/services/
* API route handlers should call service-layer functions
* Constants must come from frontend/lib/constants.ts
* Prisma client must come from frontend/lib/prisma.ts
* Admin auth must use frontend/lib/admin-auth.ts
* Buyer, dealer, and affiliate auth must remain separate from admin auth
* Never run tests against production
* Never commit .env.local
* Never commit .next
* Never commit real credentials
* Never remove cron routes without explicit approval
⸻
Git Workflow
Default branch:
main
Commit format:
type(scope): description
Allowed types:
feat
fix
chore
refactor
docs
test
perf
security
⸻
License
Proprietary — AutoLenis, LLC. All rights reserved.
AutoLenis, LLC
12800 Westridge Blvd, Suite 114
Frisco, TX 75035

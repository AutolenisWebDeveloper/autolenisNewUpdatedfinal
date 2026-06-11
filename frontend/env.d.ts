// AutoLenis V4 — env.d.ts — All required environment variables typed
declare namespace NodeJS {
  interface ProcessEnv {
    // Supabase
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    DATABASE_URL: string;
    DIRECT_URL: string;

    // Stripe (LIVE keys in production)
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: string;

    // DocuSign
    DOCUSIGN_CLIENT_ID: string;
    DOCUSIGN_INTEGRATION_KEY: string;
    DOCUSIGN_CLIENT_SECRET: string;
    DOCUSIGN_PRIVATE_KEY_BASE64: string; // Base64-encoded PEM
    DOCUSIGN_ACCOUNT_ID: string;
    DOCUSIGN_USER_ID: string;
    DOCUSIGN_AUTH_SERVER: string;
    DOCUSIGN_OAUTH_BASE_URL: string;
    DOCUSIGN_BASE_URL: string;
    DOCUSIGN_BASE_PATH: string;
    DOCUSIGN_ENV: string; // sandbox | production
    DOCUSIGN_DEALER_TEMPLATE_ID: string;
    DOCUSIGN_RETURN_URL: string;
    DOCUSIGN_WEBHOOK_SECRET: string;
    DOCUSIGN_CONNECT_SECRET: string;
    DOCUSIGN_CONFIGURATION_ID: string;

    // MicroBilt iPredict
    MICROBILT_CLIENT_ID: string;
    MICROBILT_CLIENT_SECRET: string;
    MICROBILT_IPREDICT_BASE_URL: string;
    MICROBILT_OAUTH_TOKEN_URL: string;
    IPREDICT_GET_REPORT_URL: string;
    IPREDICT_REPORT_PERFORMANCE_URL: string;
    IPREDICT_GET_ARCHIVE_REPORT_URL: string;
    MICROBILT_SANDBOX?: string; // "true" — bypass real MicroBilt and return mock APPROVED result
    // iPredict Advantage production cutover (iPredict_6.yaml spec).
    // *_BASE_URL must include the POST /GetReport suffix per spec.
    MICROBILT_BASE_URL?: string;          // e.g. https://api.microbilt.com/iPredict/GetReport
    MICROBILT_SANDBOX_URL?: string;       // e.g. https://apitest.microbilt.com/iPredict/GetReport
    MICROBILT_OAUTH_BASE_URL?: string;    // e.g. https://api.microbilt.com/OAuth/Token
    MICROBILT_OAUTH_SANDBOX_URL?: string; // e.g. https://apitest.microbilt.com/OAuth/Token
    MICROBILT_PRODUCT?: string;           // "IPredict Advantage"
    MICROBILT_CAID?: string;              // MicroBilt account identifier (e.g. 29922)

    // Communication (Resend ONLY)
    RESEND_API_KEY: string;
    FROM_NAME: string;
    // Resend webhook signing secret (Svix) — verifies delivery/bounce events.
    RESEND_WEBHOOK_SECRET?: string;

    // Phase 4B-3 — Dealer outreach email send. From/reply addresses live on a
    // dedicated sending domain (DNS configured separately). CAN-SPAM requires a
    // real physical mailing address in every commercial email footer.
    DEALER_OUTREACH_FROM_EMAIL?: string;   // e.g. "dealers@autolenis.com"
    DEALER_OUTREACH_REPLY_TO?: string;     // e.g. "markist@skaipay.com"
    AUTOLENIS_PHYSICAL_ADDRESS?: string;   // required by CAN-SPAM
    // Ops inbox for AutoLenis admin alerts (new MANUAL_REVIEW / OFAC prequals,
    // provider errors, dealer-application notifications, morning briefings).
    // Senders fail safe and skip if unset.
    ADMIN_NOTIFICATION_EMAIL?: string;

    // AI — Groq is the primary LLM provider. Gemini 2.5 Flash is used only for
    // grounded search (Maps dealer discovery + Phase 4B-1 email enrichment).
    GROQ_API_KEY: string;
    GEMINI_API_KEY?: string; // Gemini 2.5 Flash — Google Search / Maps grounding
    AI_KILL_SWITCH?: string; // "true" | "false" — disable all AI

    // Security secrets
    JWT_SECRET: string;
    CSRF_SECRET: string;
    EMAIL_UNSUBSCRIBE_SECRET: string;
    PREQUAL_ENCRYPTION_KEY: string; // 64-char hex = 32-byte AES-256-GCM key
    MFA_ENCRYPTION_KEY?: string;    // 64-char hex = 32-byte AES-256-GCM key dedicated to TOTP secrets
    CRON_SECRET: string;
    SUPABASE_JWT_SECRET: string;

    // AMIPS Phase 3 — Search Intelligence (Google Search Console).
    // Base64-encoded Google service-account JSON; the account must be added as a
    // user on the Search Console property. Optional — the search-sync cron
    // no-ops when unset. GSC_SITE_URL overrides the property URL (defaults to
    // NEXT_PUBLIC_APP_URL).
    GOOGLE_SEARCH_CONSOLE_KEY?: string;
    GSC_SITE_URL?: string;

    // Platform
    NEXT_PUBLIC_APP_URL: string;
    MAINTENANCE_MODE: string;
    // Group 8 (8A) — salt for hashing visitor IPs on affiliate referral clicks
    // (optional; falls back to a built-in default when unset).
    REFERRAL_IP_SALT?: string;
    CURRENT_TERMS_VERSION: string;
    OPENROAD_PARTNER_ID: string;

    // GoHighLevel CRM — inbound webhook for platform-event tag sync (optional;
    // tag sync no-ops when unset).
    GHL_WEBHOOK_URL?: string;

    // CRM dispatch auth — the inbound /api/crm/dispatch/* endpoints accept two
    // independent credentials (lib/crm/dispatch-auth-decision.ts). Either alone
    // authenticates; the other protections (timestamp skew, idempotency, rate
    // limit) apply to both paths.
    //   - CRM_DISPATCH_SECRET: HMAC-SHA256 signing key for code callers
    //     (X-AutoLenis-Signature). Primary path. UNCHANGED.
    //   - CRM_DISPATCH_KEY: high-entropy static bearer (X-Dispatch-Key) so Make's
    //     no-code plain-HTTP module can call without client-side signing. MUST be
    //     >= 32 random bytes (base64/hex), e.g. `openssl rand -base64 32`. It is
    //     INDEPENDENT of CRM_DISPATCH_SECRET — rotating one does not touch the
    //     other.
    CRM_DISPATCH_SECRET: string;
    CRM_DISPATCH_KEY?: string;

    // QStash (Upstash) — job queue + scheduled automation dispatch
    QSTASH_TOKEN: string;
    QSTASH_CURRENT_SIGNING_KEY: string;
    QSTASH_NEXT_SIGNING_KEY: string;

    // Twilio — transactional SMS (consent-gated) + voice receptionist
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    TWILIO_PHONE_NUMBER?: string;
    TWILIO_TRANSFER_NUMBER?: string; // legacy live-agent transfer number (Phase 3 fallback)

    // Zura Phase 3 — live call transfer to the founder. FOUNDER_PHONE_NUMBER is
    // the founder's cell that hot leads are bridged to via Twilio <Dial>; it is
    // also reused for founder SMS alerts. ENABLE_LIVE_CALL_TRANSFER is the
    // runtime kill-switch — transfers run only when it is exactly "true", so the
    // founder can pause them (meetings, travel) without a code deploy. When
    // either is unset, callers fall through to the message-taking flow.
    FOUNDER_PHONE_NUMBER?: string;
    ENABLE_LIVE_CALL_TRANSFER?: string; // "true" enables live transfers; default off

    // ElevenLabs — Turbo v2.5 TTS for the Zura voice receptionist. Audio is
    // synthesized with the cloned professional voice and served from the
    // public `zura-audio` Supabase storage bucket. Falls back to Polly <Say>
    // when unset.
    ELEVENLABS_API_KEY?: string;
    ELEVENLABS_VOICE_ID?: string;

    // Zura Phase 4 — Whisper STT. OpenAI Whisper (whisper-1) transcribes the
    // caller's recorded speech instead of Twilio's built-in experimental
    // speech model, dramatically improving accuracy on vehicle names, zip
    // codes, dollar amounts, and trim levels. Falls back to Twilio STT when
    // unset or when VOICE_USE_WHISPER === "false".
    OPENAI_API_KEY?: string;
    // Rollback switch: set to "false" to revert the voice receptionist to
    // Twilio's built-in <Gather> STT without a code deploy. Any other value
    // (or unset) keeps Whisper STT active.
    VOICE_USE_WHISPER?: string;

    // Optional
    REDIS_URL?: string;
    DEV_EMAIL_TO?: string; // Must NOT be set in production
    SENTRY_DSN?: string;

    // Phase 1 — Announcement Banner (optional; banner hidden if not set)
    NEXT_PUBLIC_ANNOUNCEMENT_MESSAGE?: string;
    NEXT_PUBLIC_ANNOUNCEMENT_LINK_TEXT?: string;
    NEXT_PUBLIC_ANNOUNCEMENT_LINK_HREF?: string;

    // Phase 1 — Video Explainer (optional; section hidden if not set)
    NEXT_PUBLIC_EXPLAINER_VIDEO_URL?: string;

    // ─── Social Intelligence & Media Engine (Session 1) ──────────────────────
    // Higgsfield — AI video generation provider. Endpoints are env-driven so the
    // exact API surface can change without a code deploy. The engine no-ops when
    // HIGGSFIELD_API_KEY is unset (NoopVideoProvider).
    // Production auth: "key_id:key_secret" used as HTTP Basic. Preferred.
    HF_CREDENTIALS?: string;
    // Production platform host, e.g. https://platform.higgsfield.ai
    HIGGSFIELD_BASE_URL?: string;
    HIGGSFIELD_WEBHOOK_SECRET?: string;     // verifies media-completion callbacks
    // Fallback Bearer token when HF_CREDENTIALS is not set.
    HIGGSFIELD_API_KEY?: string;
    HIGGSFIELD_API_BASE_URL?: string;       // legacy — e.g. https://api.higgsfield.ai
    HIGGSFIELD_SUBMIT_ENDPOINT?: string;    // legacy — kept for compatibility
    HIGGSFIELD_STATUS_ENDPOINT?: string;    // legacy — kept for compatibility

    // Runway ML — Gen-4 Turbo image-to-video provider. DALL-E stills are
    // animated into 5-second videos for Tier 1 platforms (TikTok / Instagram /
    // YouTube). The video-generation cron no-ops when RUNWAY_API_KEY is unset.
    RUNWAY_API_KEY?: string;

    // Buffer — social publishing provider. One profile id per platform. The
    // engine no-ops when BUFFER_API_KEY is unset (NoopPublishingProvider).
    BUFFER_API_KEY?: string;
    BUFFER_ORGANIZATION_ID?: string;
    BUFFER_PROFILE_FACEBOOK?: string;
    BUFFER_PROFILE_INSTAGRAM?: string;
    BUFFER_PROFILE_TIKTOK?: string;
    BUFFER_PROFILE_YOUTUBE?: string;
    BUFFER_PROFILE_LINKEDIN?: string;

    // LinkedIn — direct company-page publishing (v2 ugcPosts API). The LinkedIn
    // provider no-ops when LINKEDIN_ACCESS_TOKEN is unset (falls back to Buffer).
    // Access token expires ~2 months after issue — rotate via the LinkedIn
    // developer OAuth token generator.
    LINKEDIN_CLIENT_ID?: string;
    LINKEDIN_CLIENT_SECRET?: string;
    LINKEDIN_ACCESS_TOKEN?: string;
    LINKEDIN_COMPANY_PAGE_ID?: string;

    // Meta — direct Facebook Page + Instagram Business publishing via the Graph
    // API (v18.0). The Meta provider no-ops when META_ACCESS_TOKEN is unset
    // (falls back to Buffer). META_AD_ACCOUNT_ID enables Custom Audience
    // retargeting uploads (act_<id> form).
    META_ACCESS_TOKEN?: string;
    META_PAGE_ID?: string;
    META_INSTAGRAM_ACCOUNT_ID?: string;
    META_AD_ACCOUNT_ID?: string;

    // TikTok — direct video publishing via the Content Posting API v2
    // (PULL_FROM_URL). The TikTok provider no-ops when TIKTOK_ACCESS_TOKEN is
    // unset (falls back to Buffer).
    TIKTOK_ACCESS_TOKEN?: string;

    // Social automation controls.
    // SOCIAL_AUTOMATION_MODE: MANUAL_REVIEW | HYBRID_AUTO | FULL_AUTO
    SOCIAL_AUTOMATION_MODE?: string;
    ENABLE_HIGGSFIELD_VIDEO?: string;       // "true" enables video generation
    ENABLE_BUFFER_PUBLISHING?: string;      // "true" enables Buffer publishing
    ENABLE_AUTO_PUBLISH?: string;           // "true" auto-schedules ready posts
    ENABLE_CREATOR_DISTRIBUTION?: string;   // "true" enables creator network
  }
}

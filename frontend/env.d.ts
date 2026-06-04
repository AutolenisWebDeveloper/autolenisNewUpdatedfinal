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

    // Platform
    NEXT_PUBLIC_APP_URL: string;
    MAINTENANCE_MODE: string;
    CURRENT_TERMS_VERSION: string;
    OPENROAD_PARTNER_ID: string;

    // GoHighLevel CRM — inbound webhook for platform-event tag sync (optional;
    // tag sync no-ops when unset).
    GHL_WEBHOOK_URL?: string;

    // QStash (Upstash) — job queue + scheduled automation dispatch
    QSTASH_TOKEN: string;
    QSTASH_CURRENT_SIGNING_KEY: string;
    QSTASH_NEXT_SIGNING_KEY: string;

    // Twilio — transactional SMS (consent-gated) + voice receptionist
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    TWILIO_PHONE_NUMBER?: string;
    TWILIO_TRANSFER_NUMBER?: string; // live-agent number for in-call transfers

    // ElevenLabs — Turbo v2.5 TTS for the Zura voice receptionist. Audio is
    // synthesized with the cloned professional voice and served from the
    // public `zura-audio` Supabase storage bucket. Falls back to Polly <Say>
    // when unset.
    ELEVENLABS_API_KEY?: string;
    ELEVENLABS_VOICE_ID?: string;

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
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bump static-generation timeout for slow CI/sandbox CPUs
  staticPageGenerationTimeout: 240,
  // Explicit CORS policy — D10
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const preconnectLinks = [
      "<https://fonts.googleapis.com>; rel=preconnect",
      "<https://js.stripe.com>; rel=preconnect",
      ...(supabaseUrl ? [`<${supabaseUrl}>; rel=preconnect`] : []),
    ].join(", ");

    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: isProd ? (process.env.NEXT_PUBLIC_APP_URL ?? "") : "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-CSRF-Token" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
        ],
      },
      // Performance + security headers for all pages
      {
        source: "/(.*)",
        headers: [
          { key: "Link", value: preconnectLinks },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
      // Cache vehicle detail pages aggressively (CDN-level)
      {
        source: "/inventory/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
        ],
      },
    ];
  },

  // Canonical redirects
  async redirects() {
    return [
      { source: "/terms", destination: "/legal/terms", permanent: true },
      { source: "/privacy", destination: "/legal/privacy", permanent: true },
      { source: "/buyer/vehicle-requests", destination: "/buyer/requests", permanent: true },
      { source: "/buyer/vehicle-requests/:path*", destination: "/buyer/requests/:path*", permanent: true },
      // Dealer route normalization
      { source: "/dealer/signin", destination: "/dealer/sign-in", permanent: true },
      { source: "/dealer-application", destination: "/dealer/apply", permanent: true },
    ];
  },

  images: {
    remotePatterns: [
      // Stock & wikimedia
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "commons.wikimedia.org" },
      // Emergent platform assets
      { protocol: "https", hostname: "customer-assets.emergentagent.com" },
      // Supabase storage (covers any project ref)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // Dev fallback
      { protocol: "https", hostname: "**" },
    ],
  },

  turbopack: {
    root: process.cwd(),
  },

  // Allow cross-origin dev access from Emergent preview cluster
  allowedDevOrigins: [
    "*.cluster-11.preview.emergentcf.cloud",
    "*.cluster-0.preview.emergentcf.cloud",
    "*.preview.emergentcf.cloud",
    "*.preview.emergentagent.com",
    "e2e-sandbox-check.cluster-0.preview.emergentcf.cloud",
    "e2e-sandbox-check.preview.emergentagent.com",
    "localhost:3000",
  ],

  // Allow server actions from Emergent preview origins
  experimental: {
    serverActions: {
      allowedOrigins: [
        "*.cluster-11.preview.emergentcf.cloud",
        "*.cluster-0.preview.emergentcf.cloud",
        "*.preview.emergentcf.cloud",
        "*.preview.emergentagent.com",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;

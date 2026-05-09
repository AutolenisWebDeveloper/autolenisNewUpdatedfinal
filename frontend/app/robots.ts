import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/buyer/", "/dealer/", "/affiliate/portal/", "/admin/", "/api/", "/auth/"],
      },
    ],
    sitemap: [`${base}/sitemap.xml`, `${base}/image-sitemap.xml`],
    host: base,
  };
}

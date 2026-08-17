import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.APP_URL ?? "https://www.miboletin.lat";
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/register", "/subscribe"], disallow: ["/api/", "/dashboard", "/cases", "/alerts", "/admin", "/settings"] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}

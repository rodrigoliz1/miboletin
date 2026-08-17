import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/register", "/subscribe"], disallow: ["/api/", "/dashboard", "/cases", "/alerts", "/admin", "/settings"] }],
    sitemap: "https://miboletin.lat/sitemap.xml",
    host: "https://miboletin.lat",
  };
}

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date();
  const siteUrl = process.env.APP_URL ?? "https://www.miboletin.lat";
  return ["", "/login", "/register", "/subscribe"].map((path) => ({ url: `${siteUrl}${path}`, lastModified: updated, changeFrequency: path ? "monthly" : "weekly", priority: path ? 0.7 : 1 }));
}

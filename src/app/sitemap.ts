import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date();
  return ["", "/login", "/register", "/subscribe"].map((path) => ({ url: `https://miboletin.lat${path}`, lastModified: updated, changeFrequency: path ? "monthly" : "weekly", priority: path ? 0.7 : 1 }));
}

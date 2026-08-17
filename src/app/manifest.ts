import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mi Boletín Judicial",
    short_name: "Mi Boletín",
    description: "Seguimiento de expedientes, resoluciones y sesiones judiciales.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f3efe7",
    theme_color: "#722f37",
    lang: "es-MX",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

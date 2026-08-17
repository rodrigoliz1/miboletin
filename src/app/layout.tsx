import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Mi Boletín Judicial", template: "%s | Mi Boletín Judicial" },
  description: "Monitoreo responsable de publicaciones judiciales para litigantes y despachos mexicanos.",
  metadataBase: new URL(process.env.APP_URL ?? "https://miboletin.lat"),
  applicationName: "Mi Boletín Judicial",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_MX",
    url: "https://miboletin.lat",
    siteName: "Mi Boletín Judicial",
    title: "Mi Boletín Judicial",
    description: "Tus expedientes, resoluciones y sesiones judiciales en un solo espacio.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Mi Boletín Judicial" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mi Boletín Judicial",
    description: "Tus expedientes, resoluciones y sesiones judiciales en un solo espacio.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <head><meta name="theme-color" content="#722f37" /></head>
      <body>{children}</body>
    </html>
  );
}

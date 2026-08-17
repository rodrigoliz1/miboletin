import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Mi Boletín Judicial", template: "%s | Mi Boletín Judicial" },
  description: "Monitoreo responsable de publicaciones judiciales para litigantes y despachos mexicanos.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}

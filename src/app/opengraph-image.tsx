import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f3efe7", color: "#26231f", padding: "72px", fontFamily: "serif" }}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", borderTop: "8px solid #722f37", paddingTop: "42px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "22px", fontFamily: "sans-serif", fontSize: "24px", letterSpacing: ".12em", color: "#722f37" }}><span style={{ width: 58, height: 58, display: "flex", alignItems: "center", justifyContent: "center", background: "#722f37", color: "white", borderRadius: 10, fontFamily: "serif", fontSize: 34, fontWeight: 700 }}>M</span> MI BOLETÍN JUDICIAL</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "930px" }}><div style={{ fontSize: "76px", lineHeight: 1.02, letterSpacing: "-.04em" }}>Tus asuntos judiciales, en orden.</div><div style={{ fontFamily: "sans-serif", fontSize: "29px", lineHeight: 1.4, color: "#6f685f" }}>Resoluciones, alertas y sesiones reunidas en un espacio profesional.</div></div>
        <div style={{ fontFamily: "sans-serif", fontSize: "22px", color: "#722f37" }}>miboletin.lat</div>
      </div>
    </div>,
    size,
  );
}

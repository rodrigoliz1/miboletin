import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#722f37", color: "#fffdf8", fontFamily: "serif", fontSize: 94, fontWeight: 700, borderRadius: 36, boxShadow: "inset 0 0 0 7px #8f5660" }}>M</div>,
    size,
  );
}

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#722f37", color: "#fffdf8", fontFamily: "serif", fontSize: 18, fontWeight: 700, borderRadius: 5 }}>M</div>,
    size,
  );
}

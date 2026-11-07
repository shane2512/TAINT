import { ImageResponse } from "next/og";

export const alt = "TAINT: allowlists check where money goes, TAINT checks who decided";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#0b0b0c", color: "#f4f4f1" }}>
        <div style={{ fontSize: 120, fontWeight: 600, letterSpacing: -4 }}>TAINT</div>
        <div style={{ fontSize: 48, marginTop: 24, maxWidth: 900, lineHeight: 1.2 }}>Allowlists check where money goes. TAINT checks who decided.</div>
        <div style={{ fontSize: 28, marginTop: 40, color: "#9a9a94" }}>Provenance-gated wallets for AI agents on NEAR</div>
      </div>
    ),
    size,
  );
}

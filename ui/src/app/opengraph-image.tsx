import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "gittr - Decentralized Git Hosting on Nostr";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background:
            "linear-gradient(135deg, rgb(12, 14, 22) 0%, rgb(25, 29, 40) 100%)",
          color: "white",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: -1,
          }}
        >
          <span style={{ color: "rgb(168, 85, 247)" }}>gittr</span>
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 34,
            opacity: 0.9,
          }}
        >
          Decentralized Git Hosting on Nostr
        </div>
      </div>
    ),
    size
  );
}

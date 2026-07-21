import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export const runtime = "nodejs";

export const alt = "gittr - Decentralized Git on Nostr";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

async function logoPngDataUrl(): Promise<string | null> {
  try {
    const cwd = process.cwd();
    const svgPath = join(cwd, "public", "logo.svg");
    const svgBuffer = await readFile(svgPath);
    const pngBuffer = await sharp(svgBuffer)
      .resize(220, 220, { fit: "contain" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const logoSrc = await logoPngDataUrl();

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
        {logoSrc ? (
          <img
            src={logoSrc}
            width={220}
            height={220}
            alt=""
            style={{ marginBottom: 8 }}
          />
        ) : null}
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
          Decentralized Git on Nostr
        </div>
      </div>
    ),
    size
  );
}

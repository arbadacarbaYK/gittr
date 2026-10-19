import type { ReactNode } from "react";

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import { formatAppOgCount } from "./app-og-card";
import { OG_SIZE } from "./create-og-image";
import type { AppOgData } from "./fetch-app-og-data";

async function svgToPngDataUrl(
  svg: string,
  size: number
): Promise<string | null> {
  try {
    const png = await sharp(Buffer.from(svg))
      .resize(size, size, { fit: "contain" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

async function gittrMarkDataUrl(): Promise<string | null> {
  try {
    const svgPath = join(process.cwd(), "public", "logo.svg");
    const svgBuffer = await readFile(svgPath);
    const pngBuffer = await sharp(svgBuffer)
      .resize(64, 64, { fit: "contain" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function githubMarkDataUrl(): Promise<string | null> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 98 96" width="98" height="96">
  <path fill="#e8eaed" fill-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.125 7.523 5.125 4.367 7.534 11.46 5.332 14.25 4.074.442-3.178 1.714-5.332 3.116-6.56-10.847-1.141-22.26-5.378-22.26-24.283 0-5.37 1.94-9.763 5.014-13.206-.485-1.223-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.815.485 13.038 3.155 3.443 5.015 7.836 5.015 13.206 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.56-.08 11.836-.08 13.47 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/>
</svg>`;
  return svgToPngDataUrl(svg, 40);
}

async function forkMarkDataUrl(): Promise<string | null> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#c8d0dc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
  <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>
</svg>`;
  return svgToPngDataUrl(svg, 36);
}

async function starMarkDataUrl(): Promise<string | null> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="#e8eaed" d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.4l1.1-6.5L2.6 9.3l6.5-.9L12 2.5z"/>
</svg>`;
  return svgToPngDataUrl(svg, 36);
}

function StatPill({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

/** Satori will not wrap a single text node. */
function OgWrappedDescription({
  text,
  width,
}: {
  text: string;
  width: number;
}) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        marginTop: 18,
        fontSize: 26,
        lineHeight: 1.35,
        color: "rgb(198, 206, 218)",
        width,
        maxWidth: width,
        maxHeight: 140,
        overflow: "hidden",
      }}
    >
      {words.map((word, i) => (
        <div key={i} style={{ display: "flex", marginRight: 8 }}>
          {word}
        </div>
      ))}
    </div>
  );
}

function Chip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        border: "1px solid rgb(55, 62, 78)",
        background: "rgb(22, 26, 36)",
        borderRadius: 999,
        padding: "8px 16px",
        fontSize: 22,
        fontWeight: strong ? 700 : 500,
        color: "rgb(210, 216, 226)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Same quiet layout as a repo share card: name and about on the left,
 * icon on the right, brand bottom-right (X paints over the bottom-left).
 */
export async function createAppOgImage(
  data: AppOgData
): Promise<ImageResponse> {
  const wantsForgeMarks = data.sourceStars != null || data.sourceForks != null;
  const [mark, githubMark, forkMark, starMark] = await Promise.all([
    gittrMarkDataUrl(),
    wantsForgeMarks ? githubMarkDataUrl() : Promise.resolve(null),
    wantsForgeMarks ? forkMarkDataUrl() : Promise.resolve(null),
    wantsForgeMarks ? starMarkDataUrl() : Promise.resolve(null),
  ]);
  const textWidth = data.iconDataUrl ? 700 : 1000;
  const nameSize = data.name.length > 42 ? 46 : data.name.length > 26 ? 58 : 72;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(145deg, rgb(10, 12, 18) 0%, rgb(20, 24, 34) 55%, rgb(14, 18, 28) 100%)",
          color: "white",
          fontFamily: "Arial, sans-serif",
          padding: "52px 64px 56px 64px",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flex: 1,
            width: "100%",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minWidth: 0,
              maxWidth: textWidth,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: nameSize,
                fontWeight: 700,
                letterSpacing: -1.2,
                lineHeight: 1.05,
                color: "rgb(245, 247, 250)",
                wordBreak: "break-word",
                maxHeight: nameSize > 58 ? 160 : 130,
                overflow: "hidden",
              }}
            >
              {data.name}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 12,
                fontSize: 28,
                color: "rgb(176, 164, 210)",
                fontWeight: 600,
              }}
            >
              {data.authorLabel}
            </div>
            {data.showAppId ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 6,
                  fontSize: 22,
                  color: "rgb(130, 140, 155)",
                }}
              >
                {data.appId}
              </div>
            ) : null}
            {data.description ? (
              <OgWrappedDescription text={data.description} width={textWidth} />
            ) : null}
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 14,
                marginTop: 22,
                maxHeight: 120,
                overflow: "hidden",
              }}
            >
              {data.sourceStars != null ? (
                <StatPill>
                  {githubMark ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={githubMark} width={32} height={32} alt="" />
                  ) : (
                    <div
                      style={{ display: "flex", fontSize: 20, fontWeight: 700 }}
                    >
                      GH
                    </div>
                  )}
                  {starMark ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={starMark} width={26} height={26} alt="" />
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      fontSize: 30,
                      fontWeight: 700,
                      color: "rgb(235, 238, 245)",
                    }}
                  >
                    {formatAppOgCount(data.sourceStars)}
                  </div>
                </StatPill>
              ) : null}
              {data.sourceForks != null ? (
                <StatPill>
                  {forkMark ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={forkMark} width={28} height={28} alt="" />
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      fontSize: 30,
                      fontWeight: 700,
                      color: "rgb(235, 238, 245)",
                    }}
                  >
                    {formatAppOgCount(data.sourceForks)}
                  </div>
                </StatPill>
              ) : null}
              {data.license ? <Chip strong>{data.license}</Chip> : null}
              {data.tags.map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
          </div>
          {data.iconDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.iconDataUrl}
              width={220}
              height={220}
              alt=""
              style={{
                borderRadius: 36,
                border: "2px solid rgb(55, 62, 78)",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 20,
            marginTop: 20,
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              background: "rgb(22, 26, 36)",
              border: "1px solid rgb(50, 56, 70)",
              borderRadius: 999,
              padding: "10px 18px 10px 12px",
            }}
          >
            {mark ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mark} width={28} height={28} alt="" />
            ) : null}
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 600,
                color: "rgb(200, 210, 225)",
              }}
            >
              gittr · nostr
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              color: "rgb(100, 110, 125)",
            }}
          >
            NIP-82
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 6,
            display: "flex",
            background: "rgb(45, 180, 170)",
          }}
        />
      </div>
    ),
    { ...OG_SIZE }
  );
}

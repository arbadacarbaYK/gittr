import type { ReactNode } from "react";

import { OG_SIZE } from "@/lib/seo/create-og-image";
import { type RepoOgData, formatOgCount } from "@/lib/seo/fetch-repo-og-data";

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

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

/** GitHub Mark (Octocat silhouette) — source forge icon on OG cards. */
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
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

/** Logo-accent repo card: name dominates; optional logo badge; dual stars. */
export async function createRepoOgImage(
  data: RepoOgData
): Promise<ImageResponse> {
  const [mark, githubMark, forkMark, starMark] = await Promise.all([
    gittrMarkDataUrl(),
    githubMarkDataUrl(),
    forkMarkDataUrl(),
    starMarkDataUrl(),
  ]);
  const hasMeta =
    data.sourceStars != null ||
    data.sourceForks != null ||
    data.nostrStars != null ||
    Boolean(data.description);

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
          padding: "56px 64px 64px 64px",
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
            gap: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minWidth: 0,
              maxWidth: data.logoDataUrl ? 760 : 1100,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: data.repoName.length > 28 ? 64 : 78,
                fontWeight: 700,
                letterSpacing: -1.5,
                lineHeight: 1.05,
                color: "rgb(245, 247, 250)",
                wordBreak: "break-word",
              }}
            >
              {data.repoName}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 14,
                fontSize: 28,
                color: "rgb(150, 160, 175)",
                fontWeight: 500,
              }}
            >
              {data.ownerLabel}
            </div>
            {data.description ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 22,
                  fontSize: 26,
                  lineHeight: 1.35,
                  color: "rgb(170, 178, 190)",
                  maxWidth: 760,
                }}
              >
                {data.description}
              </div>
            ) : null}

            {(data.sourceStars != null ||
              data.sourceForks != null ||
              data.nostrStars != null) && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 32,
                  marginTop: hasMeta ? 28 : 36,
                }}
              >
                {data.sourceStars != null ? (
                  <StatPill>
                    {githubMark ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={githubMark} width={36} height={36} alt="" />
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          fontSize: 22,
                          fontWeight: 700,
                          color: "rgb(200, 210, 225)",
                        }}
                      >
                        GH
                      </div>
                    )}
                    {starMark ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={starMark} width={28} height={28} alt="" />
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        fontSize: 34,
                        fontWeight: 700,
                        color: "rgb(235, 238, 245)",
                      }}
                    >
                      {formatOgCount(data.sourceStars)}
                    </div>
                  </StatPill>
                ) : null}

                {data.sourceForks != null ? (
                  <StatPill>
                    {forkMark ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={forkMark} width={32} height={32} alt="" />
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          fontSize: 22,
                          fontWeight: 700,
                          color: "rgb(160, 170, 185)",
                        }}
                      >
                        fork
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        fontSize: 34,
                        fontWeight: 700,
                        color: "rgb(235, 238, 245)",
                      }}
                    >
                      {formatOgCount(data.sourceForks)}
                    </div>
                  </StatPill>
                ) : null}

                {data.nostrStars != null ? (
                  <StatPill>
                    <div
                      style={{
                        display: "flex",
                        width: 36,
                        height: 36,
                        borderRadius: 99,
                        background: "rgb(98, 55, 155)",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        fontWeight: 700,
                        color: "rgb(235, 225, 255)",
                      }}
                    >
                      N
                    </div>
                    {starMark ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={starMark} width={28} height={28} alt="" />
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        fontSize: 34,
                        fontWeight: 700,
                        color: "rgb(235, 238, 245)",
                      }}
                    >
                      {formatOgCount(data.nostrStars)}
                    </div>
                  </StatPill>
                ) : null}
              </div>
            )}
          </div>

          {data.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logoDataUrl}
              width={220}
              height={220}
              alt=""
              style={{
                borderRadius: 32,
                border: "2px solid rgb(55, 62, 78)",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          ) : null}
        </div>

        {/*
          X/Twitter paints a link-name chip over the bottom-left of large cards.
          Keep that corner empty; brand + NIP sit bottom-right.
        */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 20,
            marginTop: 28,
            width: "100%",
            paddingBottom: 8,
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
            NIP-34
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

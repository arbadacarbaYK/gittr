import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  formatOgCount,
  type RepoOgData,
} from "@/lib/seo/fetch-repo-og-data";
import { OG_SIZE } from "@/lib/seo/create-og-image";

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

/** Logo-accent repo card: name dominates; optional logo badge; dual stars. */
export async function createRepoOgImage(
  data: RepoOgData
): Promise<ImageResponse> {
  const mark = await gittrMarkDataUrl();
  const hasMeta =
    data.sourceStars != null ||
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
          padding: "56px 64px 48px 64px",
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
              maxWidth: data.logoDataUrl ? 820 : 1100,
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

            {(data.sourceStars != null || data.nostrStars != null) && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 28,
                  marginTop: hasMeta ? 28 : 36,
                }}
              >
                {data.sourceStars != null ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
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
                    <div
                      style={{
                        display: "flex",
                        fontSize: 18,
                        color: "rgb(130, 140, 155)",
                        letterSpacing: 0.3,
                      }}
                    >
                      source stars
                    </div>
                  </div>
                ) : null}

                {data.sourceStars != null && data.nostrStars != null ? (
                  <div
                    style={{
                      display: "flex",
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: "rgb(70, 78, 92)",
                      marginTop: 18,
                    }}
                  />
                ) : null}

                {data.nostrStars != null ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          width: 28,
                          height: 28,
                          borderRadius: 99,
                          background: "rgb(98, 55, 155)",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 700,
                          color: "rgb(235, 225, 255)",
                        }}
                      >
                        N
                      </div>
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
                    </div>
                    <div
                      style={{
                        display: "flex",
                        fontSize: 18,
                        color: "rgb(130, 140, 155)",
                        letterSpacing: 0.3,
                      }}
                    >
                      nostr stars
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {data.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logoDataUrl}
              width={160}
              height={160}
              alt=""
              style={{
                borderRadius: 28,
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
            justifyContent: "space-between",
            marginTop: 24,
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

import { Suspense } from "react";

import { AppsDirectoryClient } from "@/app/apps/AppsDirectoryClient";
import { softwareAppJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-script";
import {
  APPS_DESCRIPTION,
  buildPageSiteMetadata,
  buildSoftwareAppDescription,
} from "@/lib/seo/site-metadata";
import { softwareAppPath } from "@/lib/seo/software-app-path";
import { findSoftwareAppInCatalog } from "@/lib/seo/software-catalog-sitemap";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { type Metadata } from "next";

export const dynamic = "force-dynamic";

function decodeAppId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: raw } = await params;
  const appId = decodeAppId(raw).trim();
  const found = await findSoftwareAppInCatalog(appId);
  const name = found?.name || appId;
  const description = found
    ? buildSoftwareAppDescription(found.name, found.appId, found.summary)
    : APPS_DESCRIPTION;
  return buildPageSiteMetadata({
    path: softwareAppPath(appId || raw),
    title: found ? `${name} — Nostr app` : "Apps",
    description,
    imagePath: "/apps/opengraph-image",
    imageAlt: found
      ? `${name} — Nostr app on gittr`
      : "gittr Apps — NIP-82 software on Nostr",
  });
}

export default async function SoftwareAppPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const appId = decodeAppId(raw).trim();
  const found = await findSoftwareAppInCatalog(appId);
  const siteUrl = getPublicSiteUrl();
  const url = `${siteUrl.replace(/\/$/, "")}${softwareAppPath(appId)}`;
  const name = found?.name || appId;
  const description = found
    ? buildSoftwareAppDescription(found.name, found.appId, found.summary)
    : APPS_DESCRIPTION;

  return (
    <>
      {found ? (
        <JsonLd
          data={softwareAppJsonLd({
            name,
            description,
            url,
            identifier: found.appId,
          })}
        />
      ) : null}
      <Suspense fallback={null}>
        <AppsDirectoryClient
          initialQuery={appId}
          initialHeadingName={found?.name || appId}
          initialHeadingSummary={found?.summary}
        />
      </Suspense>
    </>
  );
}

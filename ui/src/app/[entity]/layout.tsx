import { resolveUserIconForMetadata } from "@/lib/utils/metadata-icon-resolver";

import { Metadata } from "next";
import { nip19 } from "nostr-tools";

// Cache configuration for link previews
// Force dynamic rendering to ensure fresh metadata for social media crawlers
// Social media platforms cache aggressively on their end, so we ensure our content is always fresh
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string }>;
}): Promise<Metadata> {
  // CRITICAL: Log immediately to verify function is being called
  console.log("[Metadata] ===== generateMetadata for [entity] CALLED =====");

  const resolvedParams = await params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space";

  console.log("[Metadata] Entity:", resolvedParams.entity);

  // Try to decode npub to get pubkey
  let pubkey: string | null = null;
  let displayName = resolvedParams.entity;

  try {
    if (resolvedParams.entity.startsWith("npub")) {
      const decoded = nip19.decode(resolvedParams.entity);
      if (decoded.type === "npub") {
        pubkey = decoded.data as string;
      }
    } else if (/^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
      pubkey = resolvedParams.entity;
      try {
        displayName = nip19.npubEncode(pubkey);
      } catch {}
    }
  } catch (error) {
    // Use entity as-is
  }

  const title = displayName;
  const url = `${baseUrl}/${encodeURIComponent(resolvedParams.entity)}`;

  // Fetch user metadata from Nostr (name, description, picture) - with timeout
  let userMetadata: {
    [key: string]: any;
    lud16?: string;
    lnurl?: string;
  } | null = null;
  if (pubkey) {
    try {
      const { fetchUserMetadata } = await import(
        "@/lib/nostr/fetch-metadata-server"
      );
      userMetadata = await Promise.race([
        fetchUserMetadata(pubkey),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      console.log(
        "[Metadata] User metadata fetched:",
        userMetadata ? "yes" : "no"
      );
    } catch (error) {
      console.warn("[Metadata] Failed to fetch user metadata:", error);
    }
  }

  // Use actual user name from Nostr if available, otherwise use displayName
  // Nostr kind 0 metadata can have 'name' or 'display_name'
  // CRITICAL: Validate that name/display_name are actually strings
  // Nostr metadata is parsed JSON and could contain any type
  let actualName = displayName; // Fallback
  if (userMetadata) {
    const nameValue = userMetadata.name;
    const displayNameValue = userMetadata.display_name;

    // Only use if it's a non-empty string
    if (typeof nameValue === "string" && nameValue.trim().length > 0) {
      actualName = nameValue;
    } else if (
      typeof displayNameValue === "string" &&
      displayNameValue.trim().length > 0
    ) {
      actualName = displayNameValue;
    }
  }

  // Nostr kind 0 metadata typically uses 'about' for description
  // CRITICAL: Validate that about/description are actually strings
  let userDescription: string | null = null;
  if (userMetadata) {
    const aboutValue = userMetadata.about;
    const descriptionValue = userMetadata.description;

    // Only use if it's a non-empty string
    if (typeof aboutValue === "string" && aboutValue.trim().length > 0) {
      userDescription = aboutValue;
    } else if (
      typeof descriptionValue === "string" &&
      descriptionValue.trim().length > 0
    ) {
      userDescription = descriptionValue;
    }
  }

  // Build description - use user's about text if available, otherwise generic
  const description = userDescription
    ? userDescription.length > 160
      ? userDescription.substring(0, 157) + "..."
      : userDescription
    : `Profile for ${actualName} on gittr - Decentralized Git Hosting on Nostr`;

  // Resolve user icon (profile picture or default)
  let iconUrl = `${baseUrl}/logo.svg`; // Default fallback
  try {
    // Try user's picture from metadata first
    if (userMetadata?.picture && userMetadata.picture.startsWith("http")) {
      iconUrl = userMetadata.picture;
      console.log(
        "[Metadata] Using user picture from metadata:",
        iconUrl.substring(0, 50)
      );
    } else {
      // Fallback to resolver
      iconUrl = await resolveUserIconForMetadata(
        resolvedParams.entity,
        baseUrl,
        800
      );
    }
  } catch (error) {
    // If resolution fails, use default
    console.warn(
      "[Metadata] Failed to resolve user icon, using default:",
      error
    );
  }

  // Ensure iconUrl is absolute
  if (!iconUrl.startsWith("http")) {
    iconUrl = `${baseUrl}${iconUrl.startsWith("/") ? "" : "/"}${iconUrl}`;
  }

  console.log("[Metadata] Final metadata:", {
    title: actualName,
    description: description.substring(0, 50),
    iconUrl: iconUrl.substring(0, 50),
  });

  return {
    title: actualName,
    description,
    openGraph: {
      title: actualName,
      description,
      url,
      type: "profile",
      siteName: "gittr",
      images: [
        {
          url: iconUrl,
          width: 1200, // X/Twitter requires at least 300x157, but 1200x630 is recommended for summary_large_image
          height: 630,
          alt: `${actualName} profile on gittr`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image", // X/Twitter requires summary_large_image for better image display
      title: actualName,
      description,
      images: [iconUrl], // Must be absolute URL, publicly accessible
    },
    alternates: {
      canonical: url,
    },
  };
}

export default function EntityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

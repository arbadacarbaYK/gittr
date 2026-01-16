import { nip19 } from "nostr-tools";

import { useNostrContext } from "./NostrContext";
import { useContributorMetadata } from "./useContributorMetadata";

export enum PermissionLevel {
  None = 0,
  Read = 1,
  ReadWrite = 2,
}

const useSession = () => {
  const { pubkey } = useNostrContext();
  // TODO: Add authInitialized back to NostrContext if needed
  const authInitialized = true; // Temporarily set to true - not in NostrContext

  // Use centralized metadata cache (same as other parts of the app)
  const metadataMap = useContributorMetadata(
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? [pubkey] : []
  );
  const metadata =
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? metadataMap[pubkey] || {} : {};

  // If we have a pubkey, we're logged in
  // authInitialized is mainly for preventing flickering during initial load when checking extensions
  // But if pubkey already exists (from localStorage), we're definitely logged in
  const isLoggedIn = !!pubkey;

  // Prioritize display_name, then name
  // If no metadata, show npub format (not shortened pubkey) for better UX
  let name: string;
  if (metadata.display_name && metadata.display_name.trim().length > 0) {
    name = metadata.display_name;
  } else if (
    metadata.name &&
    metadata.name.trim().length > 0 &&
    metadata.name !== "Anonymous Nostrich"
  ) {
    name = metadata.name;
  } else if (isLoggedIn && pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
    // Show npub format instead of shortened pubkey
    try {
      const npub = nip19.npubEncode(pubkey);
      name = npub.substring(0, 16) + "..."; // Show first 16 chars of npub
    } catch (error) {
      // Fallback to shortened pubkey only if npub encoding fails
      name = pubkey.slice(0, 8);
    }
  } else {
    name = "Anonymous Nostrich";
  }

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return {
    isLoggedIn,
    permissionLevel: isLoggedIn ? PermissionLevel.Read : PermissionLevel.None,
    name,
    initials,
    picture: metadata.picture,
  };
};

export default useSession;

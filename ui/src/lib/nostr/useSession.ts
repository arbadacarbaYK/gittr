import { nip19 } from "nostr-tools";

import { useNostrContext } from "./NostrContext";
import { pickProfileDisplayName } from "./kind0-profile-fields";
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
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey)
      ? metadataMap[pubkey.toLowerCase()] || metadataMap[pubkey] || {}
      : {};

  // If we have a pubkey, we're logged in
  // authInitialized is mainly for preventing flickering during initial load when checking extensions
  // But if pubkey already exists (from localStorage), we're definitely logged in
  const isLoggedIn = !!pubkey;

  const profileName = pickProfileDisplayName(metadata);
  let name: string;
  if (profileName) {
    name = profileName;
  } else if (isLoggedIn && pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
    try {
      const npub = nip19.npubEncode(pubkey);
      name = npub.substring(0, 16) + "...";
    } catch {
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
    /** Kind-0 display name, or null when we only have the npub fallback. */
    profileName,
    initials,
    picture: metadata.picture,
    banner: metadata.banner,
  };
};

export default useSession;

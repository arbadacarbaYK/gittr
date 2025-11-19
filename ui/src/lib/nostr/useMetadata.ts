import { useEffect, useState } from "react";

import { useNostrContext } from "./NostrContext";

export type Metadata = {
  banner?: string;
  website?: string;
  nip05?: string;
  picture?: string;
  lud16?: string;
  display_name?: string;
  about?: string;
  name?: string;
};

const useMetadata = (relays: string[] = []) => {
  const { subscribe, defaultRelays, pubkey } = useNostrContext();

  const [metadata, setMetadata] = useState<Metadata>({});
  useEffect(() => {
    if (!subscribe || !pubkey) return;
    
    // Set timeout to prevent hanging indefinitely
    const timeout = setTimeout(() => {
      console.log("Metadata fetch timeout after 10s");
    }, 10000);

    let unsub: (() => void) | undefined;
    
    try {
      unsub = subscribe(
        [
          {
            kinds: [0],
            authors: [pubkey],
          },
        ],
        [...defaultRelays, ...relays],
        (event, isAfterEose, relayURL) => {
          if (!isAfterEose && event.kind === 0) {
            try {
              const data = JSON.parse(event.content) as Metadata;
              setMetadata(data);
            } catch (e) {
              console.error("Failed to parse metadata:", e);
            }
          }
        },
        undefined,
        (events, relayURL) => {
          // EOSE - all metadata loaded, clear timeout
          clearTimeout(timeout);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe for metadata:", error);
      clearTimeout(timeout);
    }

    return () => {
      clearTimeout(timeout);
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  return metadata;
};

export default useMetadata;

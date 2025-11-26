"use client";

import { useEffect } from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";

import { useRouter } from "next/navigation";
import { nip19 } from "nostr-tools";

export default function ProfileRedirectPage() {
  const { pubkey } = useNostrContext();
  const { isLoggedIn } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace("/settings/profile");
      return;
    }

    if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
      router.replace(`/${nip19.npubEncode(pubkey)}`);
    } else if (pubkey) {
      router.replace(`/${pubkey}`);
    } else {
      router.replace("/settings/profile");
    }
  }, [pubkey, isLoggedIn, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080b11] text-gray-300">
      <p>Redirecting to your profile...</p>
    </div>
  );
}


"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SoftwareAppDirectoryCard,
  SoftwareAppProfileFooter,
} from "@/components/apps/SoftwareAppDirectoryCard";
import { SoftwareAppRemoveListingButton } from "@/components/apps/SoftwareAppRemoveListingButton";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  type ParsedSoftwareApp,
  appDedupKey,
} from "@/lib/nostr/nip82-software";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";

import { Smartphone } from "lucide-react";
import Link from "next/link";

type CatalogResponse = {
  apps?: ParsedSoftwareApp[];
};

export function YourAppsClient() {
  const { isLoggedIn } = useSession();
  const { pubkey } = useNostrContext();
  const ownerHex =
    pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? pubkey.toLowerCase() : "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<ParsedSoftwareApp[]>([]);

  const load = useCallback(async () => {
    if (!ownerHex) {
      setApps([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/nostr/software-catalog?author=${encodeURIComponent(ownerHex)}`
      );
      const body = (await res.json()) as CatalogResponse & { error?: string };
      if (!res.ok) {
        throw new Error(body.error || "Could not load your apps.");
      }
      setApps(Array.isArray(body.apps) ? body.apps : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your apps.");
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, [ownerHex]);

  useEffect(() => {
    void load();
  }, [load]);

  const pubkeys = useMemo(() => {
    const s = new Set<string>();
    if (ownerHex) s.add(ownerHex);
    for (const a of apps) s.add(a.pubkey.toLowerCase());
    return Array.from(s);
  }, [ownerHex, apps]);
  const metadataMap = useContributorMetadata(pubkeys);

  if (!isLoggedIn || !ownerHex) {
    return (
      <p className="text-sm text-gray-400">
        Sign in to list the apps you published and remove a leftover listing.{" "}
        <Link href="/login" className="text-[var(--color-accent-primary)]">
          Sign in
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-gray-400">
        These are your NIP-82 listings on relays (one card per app id). Removing
        a listing sends a delete request for that id only — keep{" "}
        <code className="rounded bg-zinc-900 px-1 text-[11px] text-zinc-300">
          space.gittr.app
        </code>{" "}
        if that is the live package. The APK file is not deleted.
      </p>
      {loading ? (
        <p className="text-sm text-gray-500">Loading your apps…</p>
      ) : null}
      {error ? <p className="text-sm text-amber-400">{error}</p> : null}
      {!loading && !error && apps.length === 0 ? (
        <p className="text-sm text-gray-500">
          No app listings found for this key yet.
        </p>
      ) : null}
      {apps.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {apps.map((app) => (
            <li key={appDedupKey(app.pubkey, app.appId)}>
              <SoftwareAppDirectoryCard
                app={app}
                authorMeta={metadataMap[app.pubkey.toLowerCase()]}
                metadataMap={metadataMap}
                footer={
                  <>
                    <SoftwareAppProfileFooter app={app} />
                    <SoftwareAppRemoveListingButton
                      appId={app.appId}
                      appName={app.name}
                      ownerPubkeyHex={ownerHex}
                      onRemoved={(id) =>
                        setApps((prev) =>
                          prev.filter(
                            (a) => a.appId.toLowerCase() !== id.toLowerCase()
                          )
                        )
                      }
                    />
                  </>
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Smartphone className="h-3.5 w-3.5" aria-hidden />
        <Link href="/apps" className="text-[var(--color-accent-primary)]">
          Browse all apps
        </Link>
      </p>
    </div>
  );
}

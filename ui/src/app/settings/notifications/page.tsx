"use client";

import { useEffect, useState } from "react";

import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveSigningCredentials,
} from "@/lib/nostr/signer";
import {
  type EventKey,
  type NotificationPrefs,
  DEFAULT_PREFS,
  deepMergePrefs,
} from "@/lib/notifications/prefs";
import {
  KIND_NOTIFICATION_PREFS,
  LEGACY_CVE_OPT_IN_D_TAG,
  NOTIFICATION_PREFS_D_TAG,
  buildNotificationPrefsUnsignedEvent,
  parseNotificationPrefsContent,
  pickLatestNotificationPrefsEvent,
} from "@/lib/notifications/notification-prefs-event";
import { SECURITY_AUDIT_UI_ENABLED } from "@/lib/security/audit-ui-flag";

import { nip19 } from "nostr-tools";

type Channel = "nostr" | "telegram";

export default function NotificationsPage() {
  const { pubkey, publish, defaultRelays, subscribe, remoteSigner } =
    useNostrContext();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [status, setStatus] = useState("");
  const [relayStatus, setRelayStatus] = useState<
    "unknown" | "synced" | "missing"
  >("unknown");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("gittr_notifications");
      const loadedPrefs = stored
        ? deepMergePrefs(JSON.parse(stored))
        : deepMergePrefs(null);

      if (pubkey && !loadedPrefs.channels.nostr.npub) {
        try {
          loadedPrefs.channels.nostr.npub = nip19.npubEncode(pubkey);
        } catch (error) {
          console.error("Failed to encode npub:", error);
        }
      }

      setPrefs(loadedPrefs);
    } catch {}
  }, [pubkey]);

  // Hydrate from latest kind 30078 on relays (multi-browser source of truth).
  useEffect(() => {
    if (!pubkey || !subscribe || !defaultRelays?.length) return;

    const collected: any[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const latest = pickLatestNotificationPrefsEvent(collected);
      if (!latest) {
        setRelayStatus("missing");
        return;
      }
      const parsed = parseNotificationPrefsContent(latest.content);
      if (!parsed) {
        setRelayStatus("missing");
        return;
      }
      setRelayStatus("synced");
      setPrefs((prev) =>
        deepMergePrefs({
          channels: {
            nostr: {
              enabled: parsed.channels.nostr.enabled,
              npub: prev.channels.nostr.npub,
            },
            telegram: {
              enabled: parsed.channels.telegram.enabled,
              handle: prev.channels.telegram.handle,
              userId: prev.channels.telegram.userId,
            },
          },
          events: parsed.events,
        })
      );
    };

    const unsub = subscribe(
      [
        {
          kinds: [KIND_NOTIFICATION_PREFS],
          authors: [pubkey],
          "#d": [NOTIFICATION_PREFS_D_TAG, LEGACY_CVE_OPT_IN_D_TAG],
          limit: 10,
        },
      ],
      defaultRelays,
      (event: any) => {
        if (event) collected.push(event);
      },
      undefined,
      () => finish()
    );

    const timer = setTimeout(finish, 4000);
    return () => {
      clearTimeout(timer);
      try {
        unsub?.();
      } catch {}
    };
  }, [pubkey, subscribe, defaultRelays]);

  const save = async () => {
    try {
      localStorage.setItem("gittr_notifications", JSON.stringify(prefs));
    } catch {
      setStatus("Failed to save locally");
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    if (!pubkey) {
      setStatus("Saved locally — log in to sync prefs to relays");
      setTimeout(() => setStatus(""), 4000);
      return;
    }
    if (!publish || !defaultRelays?.length) {
      setStatus("Saved locally, but no relays to publish");
      setTimeout(() => setStatus(""), 4000);
      return;
    }

    try {
      setStatus(
        remoteSigner?.getSession()
          ? "Waiting for signer…"
          : "Publishing notification prefs…"
      );
      const signingCreds = await resolveSigningCredentials({
        remoteSigner,
        maxWaitMs: 30_000,
      });
      if (!signingCreds) {
        throw new Error(NO_SIGNING_METHOD_MESSAGE);
      }
      const { signer } = signingCreds;
      const signerPubkey = await signer.getPublicKey();
      const unsigned = buildNotificationPrefsUnsignedEvent(
        signerPubkey,
        prefs
      );
      const signed = await signer.signEvent(unsigned);
      publish(signed, defaultRelays);

      const consentRes = await fetch("/api/notifications/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: signed,
          telegramUserId: prefs.channels.telegram.userId || "",
        }),
      });
      if (!consentRes.ok) {
        const err = await consentRes.json().catch(() => ({}));
        console.warn("[Notifications] consent API failed:", err);
        setRelayStatus("synced");
        setStatus(
          "Saved on relays — delivery sync failed (check Telegram User ID if Telegram is on)"
        );
        setTimeout(() => setStatus(""), 5000);
        return;
      }

      setRelayStatus("synced");
      setStatus("Saved — prefs published to relays + delivery registered");
      setTimeout(() => setStatus(""), 3500);
    } catch (error) {
      console.warn("[Notifications] prefs publish failed:", error);
      setStatus("Saved locally, but relay publish failed");
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const toggleEvent = (key: EventKey) => {
    setPrefs((p) => ({
      ...p,
      events: { ...p.events, [key]: !p.events[key] },
    }));
  };

  const toggleChannel = (ch: Channel) => {
    setPrefs((p) => ({
      ...p,
      channels: {
        ...p.channels,
        [ch]: { ...p.channels[ch], enabled: !p.channels[ch].enabled },
      },
    }));
  };

  return (
    <div className="p-6">
      <SettingsHero title="Notifications" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <section className="space-y-3">
          <h3 className="font-semibold">Channels</h3>
          <p className="text-xs text-gray-500">
            Relay sync:{" "}
            <strong className="text-gray-300">
              {relayStatus === "synced"
                ? "synced"
                : relayStatus === "missing"
                ? "no prefs event yet — Save to publish"
                : "checking…"}
            </strong>
          </p>
          <div className="space-y-2 p-3 border border-[#383B42] rounded">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.channels.nostr.enabled}
                onChange={() => toggleChannel("nostr")}
              />
              <span>Nostr DM</span>
            </label>
            {prefs.channels.nostr.enabled && (
              <div className="ml-6">
                <Label htmlFor="npub">
                  Your npub (for self-test/DM fallback)
                </Label>
                <Input
                  id="npub"
                  placeholder="npub1... (optional)"
                  value={prefs.channels.nostr.npub || ""}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      channels: {
                        ...p.channels,
                        nostr: { ...p.channels.nostr, npub: e.target.value },
                      },
                    }))
                  }
                />
              </div>
            )}
          </div>

          <div className="space-y-2 p-3 border border-[#383B42] rounded">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.channels.telegram.enabled}
                onChange={() => toggleChannel("telegram")}
              />
              <span>Telegram</span>
            </label>
            {prefs.channels.telegram.enabled && (
              <div className="ml-6 space-y-2">
                <div>
                  <Label htmlFor="tg-handle">Telegram handle (optional)</Label>
                  <Input
                    id="tg-handle"
                    placeholder="@username (optional, @ not required)"
                    value={prefs.channels.telegram.handle || ""}
                    onChange={(e) => {
                      let handle = e.target.value;
                      if (handle.startsWith("@")) {
                        handle = handle.substring(1);
                      }
                      setPrefs((p) => ({
                        ...p,
                        channels: {
                          ...p.channels,
                          telegram: { ...p.channels.telegram, handle },
                        },
                      }));
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="tg-userid">
                    Telegram User ID (required for DMs)
                  </Label>
                  <Input
                    id="tg-userid"
                    placeholder="123456789"
                    value={prefs.channels.telegram.userId || ""}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        channels: {
                          ...p.channels,
                          telegram: {
                            ...p.channels.telegram,
                            userId: e.target.value,
                          },
                        },
                      }))
                    }
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Open{" "}
                    <a
                      href="https://t.me/gittrupdatebot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:text-purple-300"
                    >
                      @gittrupdatebot
                    </a>
                    , send <code className="text-gray-300">/start</code>, and
                    paste the User ID. It is stored on this server for delivery —
                    not published to public relays. You can enable Nostr and
                    Telegram together.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold">Notify me about</h3>
          <div className="grid grid-cols-1 gap-2 p-3 border border-[#383B42] rounded">
            {(
              [
                ["repo_watch", "Someone watches my repo"],
                ["repo_star", "Someone stars my repo"],
                ["repo_zap", "My repo gets zapped"],
                ["issue_opened", "New issue in watched repos"],
                ["issue_commented", "Comments on issues I opened/participate"],
                ["pr_opened", "New pull request in watched repos"],
                ["pr_review", "Reviews requested or comments on my PRs"],
                ["pr_merged", "My PR merged"],
                ["mention", "I am @mentioned"],
                ["bounty_funded", "My Bounties"],
                ["bounty_released", "Bounty released to me"],
                [
                  "security_cve",
                  "Security: a known CVE affects my repo's exact dependency versions",
                ],
              ] as [EventKey, string][]
            )
              .filter(
                ([key]) => key !== "security_cve" || SECURITY_AUDIT_UI_ENABLED
              )
              .map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!!prefs.events[key]}
                    onChange={() => toggleEvent(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
          </div>

          {SECURITY_AUDIT_UI_ENABLED && (
            <div className="space-y-1.5 rounded border border-[#383B42] bg-black/20 p-3 text-xs text-gray-400">
              <p className="font-semibold text-gray-300">
                About security (CVE) alerts
              </p>
              <p>
                Confirmed lockfile matches only (direct + CRITICAL/HIGH). The
                Security toggle is part of the same kind{" "}
                {KIND_NOTIFICATION_PREFS} prefs event (
                <code>d={NOTIFICATION_PREFS_D_TAG}</code>) as everything else
                above — Save publishes all toggles for multi-browser sync.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={() => void save()}>SAVE NOW</Button>
            {status && <span className="text-gray-400 text-sm">{status}</span>}
            <p className="text-xs text-gray-500">
              Changes are not active until you click &quot;SAVE NOW&quot;
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

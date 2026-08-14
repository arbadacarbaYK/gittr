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
  KIND_NOTIFICATION_PREFS,
  LEGACY_CVE_OPT_IN_D_TAG,
  NOTIFICATION_PREFS_D_TAG,
  buildNotificationPrefsUnsignedEvent,
  parseNotificationPrefsContent,
  pickLatestNotificationPrefsEvent,
} from "@/lib/notifications/notification-prefs-event";
import {
  DEFAULT_PREFS,
  type EventKey,
  type NotificationPrefs,
  deepMergePrefs,
} from "@/lib/notifications/prefs";
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
      const unsigned = buildNotificationPrefsUnsignedEvent(signerPubkey, prefs);
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

      <div className="mt-4 space-y-2 rounded border border-[#383B42] bg-black/20 p-4 text-sm text-gray-400">
        <p className="font-semibold text-gray-300">How delivery works</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-gray-300">Save now</strong> publishes your
            toggles to Nostr (kind {KIND_NOTIFICATION_PREFS},{" "}
            <code className="text-xs">d={NOTIFICATION_PREFS_D_TAG}</code>) so
            they follow you across browsers — not just this device.
          </li>
          <li>
            DMs go to <strong className="text-gray-300">you</strong> based on
            these saved prefs (Nostr and/or Telegram). Someone else acting on
            your repo cannot hijack your channels via their browser settings.
          </li>
          <li>
            Telegram User ID stays on the gittr server for delivery and is{" "}
            <strong className="text-gray-300">never</strong> put on public
            relays. You can use Nostr DM, Telegram, or both.
          </li>
          <li>
            Collaboration events (issues/PRs/mentions/bounties) can notify as
            soon as they happen on Nostr. Security (CVE) alerts are{" "}
            <strong className="text-gray-300">opt-in</strong>, only for repos
            with a usable gittr mirror (created / imported / pushed here — not
            every repo announced from another client), only when that mirror
            matches your Push announcement (kind 30618) — if GitHub/forge moved,
            sync from source then{" "}
            <strong className="text-gray-300">Push</strong> (a browser-only
            refetch without Push does not fix a tip mismatch) — and reviewed
            before mass send. See Help → Security alerts.
          </li>
        </ul>
        <p className="text-xs text-gray-500">
          More detail:{" "}
          <a
            href="/help#notifications"
            className="text-purple-400 hover:text-purple-300"
          >
            Help → Notifications
          </a>
          {SECURITY_AUDIT_UI_ENABLED ? (
            <>
              {" "}
              ·{" "}
              <a
                href="/help#security-alerts"
                className="text-purple-400 hover:text-purple-300"
              >
                Security alerts
              </a>
            </>
          ) : null}
        </p>
      </div>

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
                  <p className="text-xs text-gray-300 mt-1">
                    <strong className="text-white">Do this first:</strong> open{" "}
                    <a
                      href="https://t.me/gittrupdatebot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[#5eead4] underline underline-offset-2 hover:text-[#99f6e4]"
                    >
                      t.me/gittrupdatebot
                    </a>
                    , tap <strong className="text-white">Start</strong> (or send{" "}
                    <code className="rounded bg-black/40 px-1 text-gray-200">
                      /start
                    </code>
                    ), then paste the User ID here. Needed for dependency notices
                    and other Telegram DMs. Stored on this server only — not on
                    public relays. You can enable Nostr and Telegram together.
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
              ] as [EventKey, string][]
            ).map(([key, label]) => (
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

            {SECURITY_AUDIT_UI_ENABLED && (
              <div className="space-y-2 border-t border-[#383B42] pt-3 mt-1">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!prefs.events.security_cve}
                    onChange={() => toggleEvent("security_cve")}
                  />
                  <span>
                    Security: published CRITICAL/HIGH advisory matches a direct
                    dependency on my gittr-hosted repo tip (version match —
                    please verify; also early pre-CVE tips by DM)
                  </span>
                </label>
                <p className="ml-6 text-xs text-gray-300">
                  <strong className="text-white">For Telegram DMs:</strong> first
                  open{" "}
                  <a
                    href="https://t.me/gittrupdatebot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#5eead4] underline underline-offset-2 hover:text-[#99f6e4]"
                  >
                    t.me/gittrupdatebot
                  </a>
                  , tap <strong className="text-white">Start</strong> / send{" "}
                  <code className="rounded bg-black/40 px-1 text-gray-200">
                    /start
                  </code>
                  , paste the User ID under{" "}
                  <strong className="text-white">Telegram</strong> above, turn
                  Telegram on, then Save. Without that chat, CVE notices cannot
                  reach Telegram (Nostr DMs still can if Nostr is enabled).
                </p>
              </div>
            )}
          </div>

          {SECURITY_AUDIT_UI_ENABLED && (
            <div className="space-y-1.5 rounded border border-[#383B42] bg-black/20 p-3 text-xs text-gray-400">
              <p className="font-semibold text-gray-300">
                About dependency notices (CVE)
              </p>
              <p className="text-gray-300">
                <strong className="text-white">Telegram setup (required for TG):</strong>{" "}
                <a
                  href="https://t.me/gittrupdatebot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#5eead4] underline underline-offset-2 hover:text-[#99f6e4]"
                >
                  Open @gittrupdatebot
                </a>{" "}
                → Start → copy User ID → paste in the Telegram section → enable
                Telegram → Save.
              </p>
              <p>
                Only published lockfile matches (direct dependency +
                CRITICAL/HIGH) on{" "}
                <strong className="text-gray-300">repos you own</strong> that
                have code on gittr (created / imported / pushed here) — not
                watched or starred projects. Want coverage of someone else&apos;s
                stack? Fork or import it under your account. A match means the
                pinned version is in an advisory&apos;s range —{" "}
                <strong className="text-gray-300">not</strong> automatic proof
                that your app is exploitable; please verify. When we notify, we
                open a normal Issues entry titled like a dependency notice (not
                an “incident”), plus your Nostr/Telegram channels. Alerts need
                your{" "}
                <strong className="text-gray-300">Nostr announcement</strong>{" "}
                (kind 30618 from Push) to match the tip on gittr — if they
                disagree, we skip rather than warn from the wrong tree. After
                GitHub (or another forge) moves on, sync that source onto gittr
                and <strong className="text-gray-300">Push</strong> again so the
                announcement catches up; a browser-only refetch without Push
                does not fix the mismatch. Opt in + Save registers consent.
              </p>
              <p>
                The same Security toggle also enables private{" "}
                <strong className="text-gray-300">early warnings</strong> when a
                public Spoiler Alert feed flags a HIGH/CRITICAL patch that looks
                  related to a direct dependency (often before a CVE). Matching
                  is intentionally strict (scoped packages / Go module paths) so
                  common names like <code className="bg-gray-800 px-1 rounded text-xs">react</code>{" "}
                  do not fire on every app. Those DMs are not listed on the
                  Dependencies tab; if that feed is down, normal OSV CVE checks
                  keep working.
              </p>
              <p>
                Details:{" "}
                <a
                  href="/help#security-alerts"
                  className="text-purple-400 hover:text-purple-300"
                >
                  Help → Dependency notices
                </a>
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

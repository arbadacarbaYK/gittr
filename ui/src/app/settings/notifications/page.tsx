"use client";

import { useEffect, useMemo, useState } from "react";

import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { SECURITY_AUDIT_UI_ENABLED } from "@/lib/security/audit-ui-flag";

import { nip19 } from "nostr-tools";

type Channel = "nostr" | "telegram";

type EventKey =
  | "repo_watch"
  | "repo_star"
  | "repo_zap"
  | "issue_opened"
  | "issue_commented"
  | "pr_opened"
  | "pr_review"
  | "pr_merged"
  | "mention"
  | "bounty_funded"
  | "bounty_released"
  | "security_cve";

type NotificationPrefs = {
  channels: {
    nostr: { enabled: boolean; npub?: string };
    telegram: { enabled: boolean; handle?: string; userId?: string };
  };
  events: Record<EventKey, boolean>;
};

const DEFAULT_PREFS: NotificationPrefs = {
  channels: {
    nostr: { enabled: true, npub: "" },
    telegram: { enabled: false, handle: "" },
  },
  events: {
    repo_watch: false,
    repo_star: false,
    repo_zap: false,
    issue_opened: true,
    issue_commented: true,
    pr_opened: true,
    pr_review: true,
    pr_merged: true,
    mention: true,
    bounty_funded: true,
    bounty_released: true,
    // Strict opt-in: the future security bot must never alert anyone who
    // did not explicitly turn this on (no-spam requirement).
    security_cve: false,
  },
};

export default function NotificationsPage() {
  const { pubkey } = useNostrContext();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [status, setStatus] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("gittr_notifications");
      const loadedPrefs = stored
        ? { ...DEFAULT_PREFS, ...JSON.parse(stored) }
        : DEFAULT_PREFS;

      // Auto-populate npub from logged-in user if not set
      if (pubkey && !loadedPrefs.channels.nostr.npub) {
        try {
          const npub = nip19.npubEncode(pubkey);
          loadedPrefs.channels.nostr.npub = npub;
        } catch (error) {
          console.error("Failed to encode npub:", error);
        }
      }

      setPrefs(loadedPrefs);
    } catch {}
  }, [pubkey]);

  const save = () => {
    try {
      localStorage.setItem("gittr_notifications", JSON.stringify(prefs));
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1500);
    } catch {
      setStatus("Failed to save");
      setTimeout(() => setStatus(""), 2000);
    }
  };

  const toggleEvent = (key: EventKey) => {
    setPrefs((p) => ({ ...p, events: { ...p.events, [key]: !p.events[key] } }));
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
                      // Strip @ if user adds it, we'll handle it in display
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
                    paste the User ID it replies with. Private DM only — nothing
                    is posted to the public channel.
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
              Every repo already shows a live vulnerability audit on its{" "}
              <strong>Dependencies</strong> tab (powered by OSV.dev). An alert
              only counts as confirmed when the <strong>exact version</strong>{" "}
              from your committed lockfile falls inside an advisory&apos;s
              affected range — never from guessed version ranges, so no alarm
              spam.
            </p>
            <p>
              Alerts will be delivered Dependabot-style: the gittr platform bot
              opens an issue on your affected repo, and you are notified through
              your normal issue notifications above. No unsolicited DMs. This is
              strictly <strong>opt-in</strong> (off by default) — the bot will
              never alert repos whose owner has not turned this on. The bot is
              not live yet — the on-page audit already is.
            </p>
            <p>
              The audit runs each time a repo&apos;s Dependencies tab is opened
              and reads lockfiles from the <strong>pushed gittr tip</strong>{" "}
              (not unpushed local edits). Advisory data is cached ~6h. Alerts
              are deduplicated: one issue per advisory per repo, ever — repeat
              scans finding the same known CVE stay silent.
            </p>
            <p>
              <a
                href="/help#security-alerts"
                className="text-purple-400 hover:text-purple-300"
              >
                How to get the most out of this (lockfiles, watching, opt-in) →
              </a>
            </p>
          </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save}>SAVE NOW</Button>
            {status && <span className="text-gray-400 text-sm">{status}</span>}
            <p className="text-xs text-gray-500">
              Changes are not active until you click "SAVE NOW"
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

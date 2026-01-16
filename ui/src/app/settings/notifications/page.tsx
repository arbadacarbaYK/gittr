"use client";

import { useEffect, useMemo, useState } from "react";

import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNostrContext } from "@/lib/nostr/NostrContext";

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
  | "bounty_released";

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
                    Get your ID: Message{" "}
                    <a
                      href="https://t.me/userinfobot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:text-purple-300"
                    >
                      @userinfobot
                    </a>{" "}
                    on Telegram
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
          </div>

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

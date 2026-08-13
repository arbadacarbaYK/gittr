"use client";

import { useEffect, useRef, useState } from "react";

import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_GRASP_LIST,
  KIND_RELAY_LIST,
  createGraspListEvent,
} from "@/lib/nostr/events";
import {
  type Nip65RelayEntry,
  buildRelayListTags,
  getUserNip65Relays,
} from "@/lib/nostr/nip65-relay-list";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveSigningCredentials,
} from "@/lib/nostr/signer";
import { getUserGraspServers } from "@/lib/utils/grasp-list";
import { getGraspServers, isGraspServer } from "@/lib/utils/grasp-servers";

import {
  ChevronDown,
  ChevronRight,
  Globe,
  Plus,
  Save,
  Server,
  XIcon,
} from "lucide-react";
import { getEventHash } from "nostr-tools";

/** nostr-relaypool exposes WebSocket.readyState (not a custom enum). */
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

/** Don't spam connect() more often than this while a relay stays CLOSED. */
const RECONNECT_NUDGE_MS = 8_000;

function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function isValidReadyState(status: number): boolean {
  return (
    status === WS_CONNECTING ||
    status === WS_OPEN ||
    status === WS_CLOSING ||
    status === WS_CLOSED
  );
}

/** Labels match live readyState — no sticky / guessed Connected. */
function labelReadyState(status: number | undefined): string {
  if (status === undefined) return "Unknown";
  if (status === WS_CONNECTING) return "Connecting...";
  if (status === WS_OPEN) return "Connected";
  if (status === WS_CLOSING) return "Closing...";
  // CLOSED: socket is down; pool auto-reconnects (and we also nudge connect()).
  if (status === WS_CLOSED) return "Reconnecting...";
  return "Unknown";
}

function mapGetNormalized<T>(map: Map<string, T>, url: string): T | undefined {
  if (map.has(url)) return map.get(url);
  const needle = normalizeRelayUrl(url);
  for (const [key, value] of map) {
    if (normalizeRelayUrl(key) === needle) return value;
  }
  return undefined;
}

export default function RelaysPage() {
  const {
    addRelay,
    defaultRelays,
    getRelayStatuses,
    subscribe,
    publish,
    pubkey,
    remoteSigner,
  } = useNostrContext();
  const [relayStatuses, setRelayStatuses] = useState<Map<string, number>>(
    new Map()
  );
  const [defaultRelaysExpanded, setDefaultRelaysExpanded] = useState(false);
  const [nip65Expanded, setNip65Expanded] = useState(true);
  const [graspListExpanded, setGraspListExpanded] = useState(true);
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastReconnectNudgeRef = useRef<Map<string, number>>(new Map());
  const relaysAddedRef = useRef<Set<string>>(new Set());

  const [nip65Relays, setNip65Relays] = useState<Nip65RelayEntry[]>([]);
  const [nip65Loading, setNip65Loading] = useState(false);
  const [nip65Saving, setNip65Saving] = useState(false);
  const [nip65Status, setNip65Status] = useState("");
  const [newNip65Relay, setNewNip65Relay] = useState("wss://");

  const [graspListServers, setGraspListServers] = useState<string[]>([]);
  const [graspListLoading, setGraspListLoading] = useState(true);
  const [graspListSaving, setGraspListSaving] = useState(false);
  const [graspListStatus, setGraspListStatus] = useState<string>("");
  const [newGraspServer, setNewGraspServer] = useState<string>("wss://");

  const defaultRelaysList = defaultRelays || [];
  const defaultGitServers = defaultRelaysList.filter(isGraspServer);
  const defaultRegularRelays = defaultRelaysList.filter(
    (r) => !isGraspServer(r)
  );

  useEffect(() => {
    if (!addRelay) return;
    try {
      // Platform defaults only — never dump the user's full NIP-65 list into the
      // app pool (that opens dozens of sockets and starves Amber bunker transport).
      for (const url of defaultRelaysList) {
        if (
          url &&
          url.startsWith("wss://") &&
          !relaysAddedRef.current.has(url)
        ) {
          addRelay(url);
          relaysAddedRef.current.add(url);
        }
      }
    } catch (error) {
      console.error("[RelaysPage] Failed to add relays to pool:", error);
    }
  }, [addRelay, defaultRelaysList]);

  useEffect(() => {
    if (!getRelayStatuses) return;

    const updateStatuses = () => {
      try {
        const statuses = getRelayStatuses();
        const poolByNorm = new Map<string, number>();
        const now = Date.now();

        if (Array.isArray(statuses)) {
          statuses.forEach((item: any) => {
            if (Array.isArray(item) && item.length >= 2) {
              const [url, status] = item;
              if (
                url &&
                typeof status === "number" &&
                isValidReadyState(status)
              ) {
                poolByNorm.set(normalizeRelayUrl(url), status);
              }
              return;
            }
            if (item && typeof item === "object") {
              const url = item.url || item.relay;
              const status =
                item.status !== undefined
                  ? item.status
                  : item.staus !== undefined
                  ? item.staus
                  : undefined;
              if (
                url &&
                typeof status === "number" &&
                isValidReadyState(status)
              ) {
                poolByNorm.set(normalizeRelayUrl(url), status);
              }
            }
          });
        }

        const bunkerTransport = new Set(
          (remoteSigner?.getTransportRelayUrls?.() || []).map(normalizeRelayUrl)
        );

        // Status / reconnect only for platform defaults — not the full NIP-65 set.
        const allRelaysToCheck = [...defaultRelaysList];

        const statusMap = new Map<string, number>();

        allRelaysToCheck.forEach((url: string) => {
          const key = normalizeRelayUrl(url);
          const poolStatus = poolByNorm.get(key);
          const isBunkerTransport = bunkerTransport.has(key);

          if (poolStatus !== undefined) {
            statusMap.set(url, poolStatus);
          } else {
            statusMap.set(url, WS_CONNECTING);
          }

          const effective = statusMap.get(url);
          if (
            addRelay &&
            !isBunkerTransport &&
            (effective === WS_CLOSED || poolStatus === undefined)
          ) {
            const lastNudge = lastReconnectNudgeRef.current.get(key) || 0;
            if (now - lastNudge >= RECONNECT_NUDGE_MS) {
              lastReconnectNudgeRef.current.set(key, now);
              addRelay(url);
            }
          }
        });

        // Overlay NIP-65 rows with pool status when the URL already overlaps
        // defaults — no extra sockets for the rest.
        for (const entry of nip65Relays) {
          const key = normalizeRelayUrl(entry.url);
          const poolStatus = poolByNorm.get(key);
          if (poolStatus !== undefined) {
            statusMap.set(entry.url, poolStatus);
          }
        }

        setRelayStatuses(statusMap);
      } catch (error) {
        console.error("[RelaysPage] Failed to get relay statuses:", error);
      }
    };

    updateStatuses();
    const initialTimeout = setTimeout(updateStatuses, 1000);
    statusCheckIntervalRef.current = setInterval(updateStatuses, 3000);

    return () => {
      clearTimeout(initialTimeout);
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, [
    getRelayStatuses,
    addRelay,
    defaultRelaysList,
    nip65Relays,
    remoteSigner,
  ]);

  const isConnected = (url: string) =>
    mapGetNormalized(relayStatuses, url) === WS_OPEN;

  const getStatusLabel = (url: string) =>
    labelReadyState(mapGetNormalized(relayStatuses, url));

  useEffect(() => {
    if (!pubkey || !subscribe || !defaultRelays) return;

    const loadNip65 = async () => {
      setNip65Loading(true);
      try {
        const entries = await getUserNip65Relays(
          subscribe,
          defaultRelays,
          pubkey
        );
        setNip65Relays(entries);
      } catch (error) {
        console.error("[NIP-65] Failed to load:", error);
      } finally {
        setNip65Loading(false);
      }
    };

    void loadNip65();
  }, [pubkey, subscribe, defaultRelays]);

  useEffect(() => {
    if (!pubkey || !subscribe || !defaultRelays) return;

    const loadGraspList = async () => {
      setGraspListLoading(true);
      try {
        const defaultGraspRelays = getGraspServers(defaultRelays);
        const userGraspServers = await getUserGraspServers(
          subscribe,
          defaultRelays,
          pubkey,
          defaultGraspRelays
        );
        setGraspListServers(userGraspServers);
      } catch (error) {
        console.error("[GRASP List] Failed to load:", error);
        setGraspListServers(getGraspServers(defaultRelays));
      } finally {
        setGraspListLoading(false);
      }
    };

    void loadGraspList();
  }, [pubkey, subscribe, defaultRelays]);

  // Save NIP-65 kind 10002 to Nostr (Amber / NIP-07 / nsec)
  const saveNip65List = async () => {
    if (!pubkey || !publish || !defaultRelays) {
      setNip65Status("Error: Not logged in");
      setTimeout(() => setNip65Status(""), 3000);
      return;
    }

    setNip65Saving(true);
    setNip65Status(
      remoteSigner?.getSession() ? "Waiting for signer…" : "Saving…"
    );

    try {
      const signingCreds = await resolveSigningCredentials({
        remoteSigner,
        maxWaitMs: 30_000,
      });
      if (!signingCreds) {
        throw new Error(NO_SIGNING_METHOD_MESSAGE);
      }
      const { signer } = signingCreds;
      const signerPubkey = await signer.getPublicKey();
      let event: any = {
        kind: KIND_RELAY_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags: buildRelayListTags(nip65Relays),
        content: "",
        pubkey: signerPubkey,
        id: "",
        sig: "",
      };
      event.id = getEventHash(event);
      event = await signer.signEvent(event);

      const publishRelays = Array.from(
        new Set([
          ...defaultRelays,
          "wss://nos.lol",
          "wss://relay.primal.net",
          "wss://purplepag.es",
          "wss://relay.gittr.space",
        ])
      );
      await publish(event, publishRelays);
      setNip65Status("✅ Saved to Nostr!");
      setTimeout(() => setNip65Status(""), 3000);
    } catch (error: any) {
      console.error("[NIP-65] Failed to save:", error);
      setNip65Status(`Error: ${error.message || "Failed to save"}`);
      setTimeout(() => setNip65Status(""), 8000);
    } finally {
      setNip65Saving(false);
    }
  };

  const addNip65Relay = () => {
    const url = newNip65Relay.trim().replace(/\/+$/, "");
    if (!url.startsWith("wss://")) {
      alert("Please enter a valid WebSocket URL (wss://...)");
      return;
    }
    const key = normalizeRelayUrl(url);
    if (nip65Relays.some((r) => normalizeRelayUrl(r.url) === key)) {
      alert("This relay is already in your list");
      return;
    }
    setNip65Relays([...nip65Relays, { url }]);
    setNewNip65Relay("wss://");
  };

  const removeNip65Relay = (url: string) => {
    const key = normalizeRelayUrl(url);
    setNip65Relays(nip65Relays.filter((r) => normalizeRelayUrl(r.url) !== key));
  };

  // Save GRASP list to Nostr (add/remove servers, then publish kind 10317)
  const saveGraspList = async () => {
    if (!pubkey || !publish || !defaultRelays) {
      setGraspListStatus("Error: Not logged in");
      setTimeout(() => setGraspListStatus(""), 3000);
      return;
    }

    setGraspListSaving(true);
    setGraspListStatus(
      remoteSigner?.getSession()
        ? "Waiting for signer (approve in Amber)…"
        : "Saving…"
    );

    try {
      const signingCreds = await resolveSigningCredentials({
        remoteSigner,
        maxWaitMs: 30_000,
      });
      if (!signingCreds) {
        throw new Error(NO_SIGNING_METHOD_MESSAGE);
      }
      const { signer, privateKey } = signingCreds;

      const graspListEvent =
        signer.source === "nsec" && privateKey
          ? createGraspListEvent({ graspServers: graspListServers }, privateKey)
          : await (async () => {
              const signerPubkey = await signer.getPublicKey();
              let event: any = {
                kind: KIND_GRASP_LIST,
                created_at: Math.floor(Date.now() / 1000),
                tags: graspListServers.map((server) => ["g", server]),
                content: "",
                pubkey: signerPubkey,
                id: "",
                sig: "",
              };
              event.id = getEventHash(event);
              event = await signer.signEvent(event);
              return event;
            })();

      await publish(graspListEvent, defaultRelays);
      setGraspListStatus("✅ Saved to Nostr!");
      setTimeout(() => setGraspListStatus(""), 3000);
    } catch (error: any) {
      console.error("[GRASP List] Failed to save:", error);
      setGraspListStatus(`Error: ${error.message || "Failed to save"}`);
      setTimeout(() => setGraspListStatus(""), 8000);
    } finally {
      setGraspListSaving(false);
    }
  };

  const addGraspServer = () => {
    const url = newGraspServer.trim();
    if (!url || !url.startsWith("wss://")) {
      alert("Please enter a valid WebSocket URL (wss://...)");
      return;
    }

    if (!isGraspServer(url)) {
      alert(
        "This is not a GRASP server. GRASP servers are git servers that also act as Nostr relays."
      );
      return;
    }

    if (graspListServers.includes(url)) {
      alert("This GRASP server is already in your list");
      return;
    }

    setGraspListServers([...graspListServers, url]);
    setNewGraspServer("wss://");
  };

  const removeGraspServer = (url: string) => {
    setGraspListServers(graspListServers.filter((s) => s !== url));
  };

  const renderRelayList = (relays: string[]) => {
    if (relays.length === 0) return null;

    return (
      <div className="space-y-2">
        {relays.map((relay: string) => {
          const connected = isConnected(relay);
          const status = mapGetNormalized(relayStatuses, relay);
          return (
            <div
              key={relay}
              className="flex items-center gap-2 p-2 bg-gray-800/50 rounded border border-gray-700"
            >
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  connected
                    ? "bg-violet-500"
                    : status === WS_CONNECTING
                    ? "border-2 border-yellow-400 bg-transparent animate-pulse"
                    : "border-2 border-violet-500 bg-transparent"
                }`}
                title={getStatusLabel(relay)}
              />
              <p className="ml-1 flex-1 break-all text-sm text-gray-300">
                {relay}
              </p>
              <span
                className={`text-xs px-2 py-1 rounded font-medium ${
                  connected
                    ? "text-green-400 bg-green-900/30"
                    : status === WS_CONNECTING || status === WS_CLOSED
                    ? "text-yellow-400 bg-yellow-900/30"
                    : status === WS_CLOSING
                    ? "text-orange-400 bg-orange-900/30"
                    : "text-red-400 bg-red-900/30"
                }`}
                title={
                  status === WS_CLOSED
                    ? "Socket closed — live readyState 3; reconnect in progress"
                    : getStatusLabel(relay)
                }
              >
                {getStatusLabel(relay)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <SettingsHero title="Relays" />

      {/* Default Relays Section - Collapsed by default */}
      {defaultRelaysList.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setDefaultRelaysExpanded(!defaultRelaysExpanded)}
            className="flex items-center gap-2 w-full mb-2 font-semibold text-sm text-gray-300 hover:text-gray-200 transition-colors"
          >
            {defaultRelaysExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Default Relays (from environment)</span>
            <span className="text-xs text-gray-500 ml-auto">
              ({defaultRelaysList.length} total)
            </span>
          </button>
          {defaultRelaysExpanded && (
            <div className="ml-6 space-y-4">
              <p className="text-xs text-gray-500 mb-3">
                These relays are configured in{" "}
                <code className="bg-gray-800 px-1 rounded">
                  NEXT_PUBLIC_NOSTR_RELAYS
                </code>{" "}
                and are used for all repository operations.
              </p>

              {/* Default Git Servers */}
              {defaultGitServers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-purple-400" />
                    <h4 className="text-xs font-semibold text-gray-400">
                      Git Servers ({defaultGitServers.length})
                    </h4>
                  </div>
                  {renderRelayList(defaultGitServers)}
                </div>
              )}

              {/* Default Regular Relays */}
              {defaultRegularRelays.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="h-4 w-4 text-blue-400" />
                    <h4 className="text-xs font-semibold text-gray-400">
                      Relays ({defaultRegularRelays.length})
                    </h4>
                  </div>
                  {renderRelayList(defaultRegularRelays)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Your Relays = NIP-65 kind 10002 (published on Nostr) */}
      <div className="mb-6">
        <button
          onClick={() => setNip65Expanded(!nip65Expanded)}
          className="flex items-center gap-2 w-full mb-2 font-semibold text-sm text-gray-300 hover:text-gray-200 transition-colors"
        >
          {nip65Expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Globe className="h-4 w-4 text-blue-400" />
          <span>Your Relays (NIP-65)</span>
          <span className="text-xs text-gray-500 ml-auto">
            ({nip65Loading ? "…" : nip65Relays.length} total)
          </span>
        </button>
        {nip65Expanded && (
          <div className="ml-6 space-y-4">
            <p className="text-xs text-gray-500 mb-3">
              Your preferred relays on Nostr (kind 10002). Status shows whether
              this browser is connected. Changes are saved with your signer.
            </p>

            {!pubkey ? (
              <p className="text-xs text-yellow-400/90 italic">
                Log in to load your Nostr relay list.
              </p>
            ) : nip65Loading ? (
              <p className="text-xs text-gray-500 italic">
                Loading your relay list from Nostr…
              </p>
            ) : (
              <>
                {nip65Relays.length > 0 ? (
                  <div className="space-y-2">
                    {nip65Relays.map((entry) => {
                      const connected = isConnected(entry.url);
                      const status = mapGetNormalized(relayStatuses, entry.url);
                      return (
                        <div
                          key={entry.url}
                          className="flex items-center gap-2 p-2 bg-gray-800/50 rounded border border-gray-700"
                        >
                          <div
                            className={`h-2 w-2 rounded-full flex-shrink-0 ${
                              connected
                                ? "bg-green-500"
                                : status === WS_CONNECTING
                                ? "bg-yellow-500"
                                : "bg-red-500"
                            }`}
                            title={getStatusLabel(entry.url)}
                          />
                          <p className="flex-1 break-all text-sm text-gray-300">
                            {entry.url}
                            {entry.marker ? (
                              <span className="ml-2 text-xs text-gray-500">
                                ({entry.marker})
                              </span>
                            ) : null}
                          </p>
                          <span className="text-xs text-gray-500 flex-shrink-0">
                            {getStatusLabel(entry.url)}
                          </span>
                          <XIcon
                            className="text-red-400 cursor-pointer hover:text-red-300 flex-shrink-0"
                            onClick={() => removeNip65Relay(entry.url)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">
                    No relay list published yet. Add relays and save.
                  </p>
                )}

                <div className="space-y-3 border-t border-gray-700 pt-4">
                  <div>
                    <Label className="text-sm text-gray-400">Add relay</Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        type="text"
                        value={newNip65Relay}
                        onChange={(e) => setNewNip65Relay(e.target.value)}
                        placeholder="wss://"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 !border-[#383B42] bg-[#22262C]"
                        onClick={addNip65Relay}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 !border-[#383B42] bg-[#22262C]"
                    disabled={nip65Saving || !pubkey}
                    onClick={saveNip65List}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {nip65Saving ? "Saving…" : "Save to Nostr"}
                  </Button>
                  {nip65Status ? (
                    <p className="text-xs text-gray-300">{nip65Status}</p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* GRASP List Section */}
      <div className="mb-6">
        <button
          onClick={() => setGraspListExpanded(!graspListExpanded)}
          className="flex items-center gap-2 w-full mb-2 font-semibold text-sm text-gray-300 hover:text-gray-200 transition-colors"
        >
          {graspListExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Server className="h-4 w-4 text-purple-400" />
          <span>Preferred GRASP Servers (NIP-34)</span>
          <span className="text-xs text-gray-500 ml-auto">
            ({graspListLoading ? "..." : graspListServers.length} servers)
          </span>
        </button>
        {graspListExpanded && (
          <div className="ml-6 space-y-4">
            <p className="text-xs text-gray-500 mb-3">
              Preferred GRASP servers for clone/push (kind 10317). Changes are
              saved with your signer.
            </p>

            {graspListLoading ? (
              <p className="text-xs text-gray-500 italic">
                Loading your GRASP list…
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {graspListServers.length > 0 ? (
                    graspListServers.map((server, index) => (
                      <div
                        key={server}
                        className="flex items-center gap-2 p-2 bg-gray-800/50 rounded border border-gray-700"
                      >
                        <span className="text-xs text-gray-400 w-6">
                          #{index + 1}
                        </span>
                        <p className="flex-1 break-all text-sm text-gray-300">
                          {server}
                        </p>
                        <XIcon
                          className="text-red-400 cursor-pointer hover:text-red-300 flex-shrink-0"
                          onClick={() => removeGraspServer(server)}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500 italic">
                      No preferred GRASP servers set. Using defaults.
                    </p>
                  )}
                </div>

                <div className="space-y-3 border-t border-gray-700 pt-4">
                  <div>
                    <Label
                      htmlFor="grasp-server"
                      className="text-sm text-gray-400"
                    >
                      Add GRASP server
                    </Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        type="text"
                        id="grasp-server"
                        placeholder="wss://"
                        value={newGraspServer}
                        onChange={(e) => setNewGraspServer(e.target.value)}
                        className="flex-1"
                        pattern="^wss:\/\/.*\..*$"
                      />
                      <Button
                        type="button"
                        onClick={addGraspServer}
                        className="h-8 !border-[#383B42] bg-[#22262C]"
                        variant="outline"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={saveGraspList}
                    disabled={graspListSaving || !pubkey}
                    className="h-8 !border-[#383B42] bg-[#22262C]"
                    variant="outline"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {graspListSaving ? "Saving…" : "Save to Nostr"}
                  </Button>

                  {graspListStatus && (
                    <p
                      className={`text-xs ${
                        graspListStatus.startsWith("✅")
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {graspListStatus}
                    </p>
                  )}

                  {!pubkey && (
                    <p className="text-xs text-yellow-400">
                      Log in to save this list to Nostr.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

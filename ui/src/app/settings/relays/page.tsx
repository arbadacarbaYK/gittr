"use client";

import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useLocalStorage from "@/lib/hooks/useLocalStorage";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { XIcon, ChevronDown, ChevronRight, Server, Globe, Plus, Save } from "lucide-react";
import { type FieldValues, useForm } from "react-hook-form";
import { useEffect, useState, useRef } from "react";
import { isGraspServer, getGraspServers } from "@/lib/utils/grasp-servers";
import { createGraspListEvent, KIND_GRASP_LIST } from "@/lib/nostr/events";
import { getUserGraspServers, parseGraspListEvent } from "@/lib/utils/grasp-list";
import { getEventHash, signEvent, getPublicKey } from "nostr-tools";

type RelayType = "relay" | "gitserver";

interface UserRelay {
  url: string;
  type: RelayType;
}

export default function RelaysPage() {
  const { addRelay, removeRelay, defaultRelays, getRelayStatuses, subscribe, publish, pubkey } = useNostrContext();
  const [relayStatuses, setRelayStatuses] = useState<Map<string, number>>(new Map());
  const [defaultRelaysExpanded, setDefaultRelaysExpanded] = useState(false);
  const [userRelaysExpanded, setUserRelaysExpanded] = useState(true);
  const [graspListExpanded, setGraspListExpanded] = useState(true);
  const [statusCheckAttempts, setStatusCheckAttempts] = useState<Map<string, number>>(new Map());
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track which relays have successfully delivered events (better indicator than WebSocket status)
  const [relaysWithEvents, setRelaysWithEvents] = useState<Map<string, number>>(new Map()); // Map<relayURL, timestamp>
  
  // GRASP list state
  const [graspListServers, setGraspListServers] = useState<string[]>([]);
  const [graspListLoading, setGraspListLoading] = useState(true);
  const [graspListSaving, setGraspListSaving] = useState(false);
  const [graspListStatus, setGraspListStatus] = useState<string>("");
  const [newGraspServer, setNewGraspServer] = useState<string>("wss://");
  const { register, handleSubmit, reset, watch } = useForm<{ relay: string; type: RelayType }>({
    defaultValues: { relay: "wss://", type: "relay" }
  });
  
  // Load user relays from localStorage (stored as array of {url, type})
  // CRITICAL: Migrate from old "relays" key to new "gittr_user_relays" format
  const [userRelays, setUserRelays] = useLocalStorage<UserRelay[]>(
    "gittr_user_relays",
    (() => {
      // Try to migrate from old format
      if (typeof window !== 'undefined') {
        try {
          const oldRelaysStr = localStorage.getItem("relays");
          if (oldRelaysStr) {
            const oldRelays = JSON.parse(oldRelaysStr) as string[];
            if (Array.isArray(oldRelays) && oldRelays.length > 0) {
              // Convert old format (string[]) to new format (UserRelay[])
              const migrated = oldRelays
                .filter(url => url && url.startsWith('wss://'))
                .map(url => ({
                  url,
                  type: (isGraspServer(url) ? "gitserver" : "relay") as RelayType
                }));
              if (migrated.length > 0) {
                console.log(`[RelaysPage] Migrated ${migrated.length} relays from old format`);
                // Save in new format
                localStorage.setItem("gittr_user_relays", JSON.stringify(migrated));
                // Remove old key
                localStorage.removeItem("relays");
                return migrated;
              }
            }
          }
        } catch (e) {
          console.warn("[RelaysPage] Failed to migrate old relays:", e);
        }
      }
      return [];
    })()
  );

  // CRITICAL: Define defaultRelaysList BEFORE it's used in useEffect hooks
  const defaultRelaysList = defaultRelays || [];
  
  // Separate default relays into git servers and regular relays
  const defaultGitServers = defaultRelaysList.filter(isGraspServer);
  const defaultRegularRelays = defaultRelaysList.filter(r => !isGraspServer(r));
  
  // Separate user relays
  const userGitServers = (userRelays || []).filter(r => r.type === "gitserver" || isGraspServer(r.url));
  const userRegularRelays = (userRelays || []).filter(r => r.type === "relay" && !isGraspServer(r.url));

  // Prevent duplicate additions
  const allRelayUrls = new Set([
    ...defaultRelaysList,
    ...(userRelays || []).map(r => r.url)
  ]);

  const onFormSubmit = (data: FieldValues) => {
    const url = (data.relay as string).trim();
    const type = (data.type as RelayType) || (isGraspServer(url) ? "gitserver" : "relay");
    
    if (!url || !url.startsWith("wss://")) {
      alert("Please enter a valid WebSocket URL (wss://...)");
      return;
    }
    
    if (allRelayUrls.has(url)) {
      alert("This relay is already added");
      return;
    }
    
    if (addRelay) {
      const newRelay: UserRelay = { url, type };
      setUserRelays([...(userRelays || []), newRelay]);
      addRelay(url);
      reset({ relay: "wss://", type: "relay" });
    }
  };

  const handleRemoval = (url: string) => {
    if (removeRelay) {
      removeRelay(url);
      setUserRelays((userRelays || []).filter(r => r.url !== url));
    }
  };

  // CRITICAL: Load user relays from NIP-07 extension if available
  useEffect(() => {
    if (typeof window === 'undefined' || !window.nostr) return;
    
    const loadNip07Relays = async () => {
      try {
        const nip07Relays = await window.nostr.getRelays();
        if (nip07Relays && typeof nip07Relays === 'object') {
          const relayUrls = Object.keys(nip07Relays).filter(url => url.startsWith('wss://'));
          if (relayUrls.length > 0) {
            console.log(`[RelaysPage] Found ${relayUrls.length} relays from NIP-07:`, relayUrls);
            
            // Merge with existing user relays (avoid duplicates)
            const existingUrls = new Set((userRelays || []).map(r => r.url));
            const newRelays: UserRelay[] = relayUrls
              .filter(url => !existingUrls.has(url) && !defaultRelaysList.includes(url))
              .map(url => ({
                url,
                type: (isGraspServer(url) ? "gitserver" : "relay") as RelayType
              }));
            
            if (newRelays.length > 0) {
              console.log(`[RelaysPage] Adding ${newRelays.length} new relays from NIP-07`);
              setUserRelays([...(userRelays || []), ...newRelays]);
            }
          }
        }
      } catch (error) {
        console.warn("[RelaysPage] Failed to load NIP-07 relays:", error);
      }
    };
    
    loadNip07Relays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // CRITICAL: Ensure ALL relays (default + user) are added to the pool on mount
  // Use a ref to prevent duplicate additions
  const relaysAddedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!addRelay) return;
    
    try {
      // Add ALL default relays to pool first
      defaultRelaysList.forEach((url: string) => {
        if (url && url.startsWith("wss://") && !relaysAddedRef.current.has(url)) {
          addRelay(url);
          relaysAddedRef.current.add(url);
        }
      });
      
      // Then add user relays
      (userRelays || []).forEach((relay: UserRelay) => {
        if (relay.url && relay.url.startsWith("wss://") && !relaysAddedRef.current.has(relay.url)) {
          addRelay(relay.url);
          relaysAddedRef.current.add(relay.url);
        }
      });
    } catch (error) {
      console.error("[RelaysPage] Failed to add relays to pool:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRelay, (userRelays || []).length]); // Re-run if user relays change

  // Track actual event delivery from relays (better indicator than WebSocket status)
  useEffect(() => {
    if (!subscribe) return;

    // Subscribe to a common event type (kind 0 metadata) to test relay health
    // This will help us identify which relays are actually working
    const testUnsub = subscribe(
      [{ kinds: [0], limit: 1 }], // Query for any metadata event (very common)
      [...defaultRelaysList, ...(userRelays || []).map(r => r.url)],
      (event, isAfterEose, relayURL) => {
        // Track that this relay successfully delivered an event
        if (relayURL && typeof relayURL === 'string') {
          setRelaysWithEvents(prev => {
            const updated = new Map(prev);
            updated.set(relayURL, Date.now());
            return updated;
          });
        }
      },
      undefined,
      undefined,
      { unsubscribeOnEose: true } // Auto-unsubscribe after EOSE to avoid spam
    );

    // Clean up after 10 seconds (enough time to test all relays)
    const cleanup = setTimeout(() => {
      if (testUnsub) testUnsub();
    }, 10000);

    return () => {
      clearTimeout(cleanup);
      if (testUnsub) testUnsub();
    };
  }, [subscribe, defaultRelaysList, (userRelays || []).length]);

  // Check relay statuses with retry limit (max 3 attempts per relay)
  useEffect(() => {
    if (!getRelayStatuses) return;

    const updateStatuses = () => {
      try {
        const statuses = getRelayStatuses();
        const statusMap = new Map<string, number>();
        const newAttempts = new Map(statusCheckAttempts);
        
        // CRITICAL: Check if relays have delivered events recently (within last 60 seconds)
        // This is a better indicator than WebSocket status
        const now = Date.now();
        const eventDeliveryThreshold = 60000; // 60 seconds
        
        // CRITICAL: Debug what we're actually getting
        console.log("[RelaysPage] getRelayStatuses() returned:", {
          isArray: Array.isArray(statuses),
          length: statuses?.length || 0,
          sample: statuses?.slice(0, 5),
          fullSample: JSON.stringify(statuses?.slice(0, 5)),
          type: typeof statuses
        });
        
        if (Array.isArray(statuses)) {
          statuses.forEach((item: any, index: number) => {
            // Handle tuple format: [url, status] - this is the expected format
            if (Array.isArray(item) && item.length >= 2) {
              const [url, status] = item;
              if (url && typeof status === 'number') {
                // CRITICAL: Normalize invalid status codes (nostr-relaypool should only return 0, 1, or 2)
                // Status 3 or other invalid codes likely mean "connecting" or "unknown" state
                // Since relays are actively reconnecting, treat invalid statuses as "connecting" (1)
                let normalizedStatus = status;
                if (status !== 0 && status !== 1 && status !== 2) {
                  // Invalid status code - normalize to "connecting" since relays are clearly trying to connect
                  normalizedStatus = 1;
                  if (index < 3) {
                    console.warn(`[RelaysPage] Invalid status code ${status} for ${url}, normalizing to 1 (connecting)`);
                  }
                }
                statusMap.set(url, normalizedStatus);
                // Debug first few items
                if (index < 3) {
                  console.log(`[RelaysPage] Parsed tuple [${index}]: url="${url}", status=${normalizedStatus} (${normalizedStatus === 0 ? 'closed' : normalizedStatus === 1 ? 'connecting' : normalizedStatus === 2 ? 'connected' : 'unknown'})`);
                }
                // Reset attempts on successful status update
                if (normalizedStatus === 2) { // Connected
                  newAttempts.delete(url);
                }
              } else {
                if (index < 3) {
                  console.warn(`[RelaysPage] Invalid tuple [${index}]:`, item);
                }
              }
            } 
            // Fallback: Handle object format
            else if (item && typeof item === 'object' && !Array.isArray(item)) {
              const url = item.url || item.relay;
              // CRITICAL: Check both "status" and "staus" (typo in type definition)
              const status = item.status !== undefined ? item.status : (item.staus !== undefined ? item.staus : undefined);
              if (url && typeof status === 'number') {
                // CRITICAL: Normalize invalid status codes (nostr-relaypool should only return 0, 1, or 2)
                let normalizedStatus = status;
                if (status !== 0 && status !== 1 && status !== 2) {
                  normalizedStatus = 1; // Treat invalid status as "connecting"
                  if (index < 3) {
                    console.warn(`[RelaysPage] Invalid status code ${status} for ${url}, normalizing to 1 (connecting)`);
                  }
                }
                statusMap.set(url, normalizedStatus);
                if (index < 3) {
                  console.log(`[RelaysPage] Parsed object [${index}]: url="${url}", status=${normalizedStatus}`);
                }
                if (normalizedStatus === 2) {
                  newAttempts.delete(url);
                }
              } else {
                if (index < 3) {
                  console.warn(`[RelaysPage] Invalid object [${index}]:`, item);
                }
              }
            } else {
              if (index < 3) {
                console.warn(`[RelaysPage] Unknown format [${index}]:`, item, typeof item);
              }
            }
          });
        } else {
          console.error("[RelaysPage] getRelayStatuses() did not return an array:", statuses);
        }
        
        // Add all known relays to status map
        const allRelaysToCheck = [
          ...defaultRelaysList,
          ...(userRelays || []).map(r => r.url)
        ];
        
        allRelaysToCheck.forEach((url: string) => {
          // CRITICAL: If relay has delivered events recently, mark as connected (status 2)
          // This overrides the WebSocket status which may be inaccurate
          const lastEventTime = relaysWithEvents.get(url);
          if (lastEventTime && (now - lastEventTime) < eventDeliveryThreshold) {
            // Relay delivered events recently - definitely working!
            statusMap.set(url, 2); // 2 = connected
            newAttempts.delete(url); // Reset attempts on success
            return;
          }
          
          if (!statusMap.has(url)) {
            const attempts = newAttempts.get(url) || 0;
            if (attempts < 3) {
              // Still trying - mark as connecting
              statusMap.set(url, 1); // 1 = connecting
              newAttempts.set(url, attempts + 1);
            } else {
              // Max attempts reached - mark as failed and stop checking
              statusMap.set(url, 0); // 0 = disconnected/failed
            }
          } else {
            // Status already set from getRelayStatuses, but upgrade to connected if events received
            const currentStatus = statusMap.get(url);
            if (currentStatus !== 2 && lastEventTime && (now - lastEventTime) < eventDeliveryThreshold) {
              statusMap.set(url, 2); // Upgrade to connected
              newAttempts.delete(url);
            }
          }
        });
        
        // Debug: log statuses
        const connected = Array.from(statusMap.entries()).filter(([_, s]) => s === 2).length;
        const connecting = Array.from(statusMap.entries()).filter(([_, s]) => s === 1).length;
        const failed = Array.from(statusMap.entries()).filter(([_, s]) => s === 0).length;
        console.log("[RelaysPage] Status summary:", {
          total: statusMap.size,
          connected,
          connecting,
          failed,
          sample: Array.from(statusMap.entries()).slice(0, 5)
        });
        
        setStatusCheckAttempts(newAttempts);
        setRelayStatuses(statusMap);
      } catch (error) {
        console.error("[RelaysPage] Failed to get relay statuses:", error);
        try {
          const rawStatuses = getRelayStatuses();
          console.error("[RelaysPage] Raw statuses value:", rawStatuses);
        } catch (e) {
          console.error("[RelaysPage] Could not get raw statuses:", e);
        }
      }
    };

    // Initial delay to let relays connect and receive events
    const initialTimeout = setTimeout(updateStatuses, 5000);
    
    // Update every 5 seconds (reduced frequency to avoid hammering)
    statusCheckIntervalRef.current = setInterval(updateStatuses, 5000);

    return () => {
      clearTimeout(initialTimeout);
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, [getRelayStatuses, defaultRelaysList, (userRelays || []).length, relaysWithEvents]); // Include relaysWithEvents to update when events are received

  // Helper to check if relay is connected
  const isConnected = (url: string) => {
    const status = relayStatuses.get(url);
    return status === 2; // Open/connected
  };
  
  // Helper to get status label
  const getStatusLabel = (url: string) => {
    const status = relayStatuses.get(url);
    const attempts = statusCheckAttempts.get(url) || 0;
    if (status === undefined) return attempts >= 3 ? "Failed" : "Unknown";
    if (status === 0) return attempts >= 3 ? "Failed" : "Disconnected";
    if (status === 1) return "Connecting...";
    if (status === 2) return "Connected";
    return "Unknown";
  };

  // Load user's GRASP list
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
        // Fallback to default GRASP servers
        const defaultGraspRelays = getGraspServers(defaultRelays);
        setGraspListServers(defaultGraspRelays);
      } finally {
        setGraspListLoading(false);
      }
    };
    
    loadGraspList();
  }, [pubkey, subscribe, defaultRelays]);

  // Save GRASP list to Nostr
  const saveGraspList = async () => {
    if (!pubkey || !publish || !defaultRelays) {
      setGraspListStatus("Error: Not logged in");
      setTimeout(() => setGraspListStatus(""), 3000);
      return;
    }

    setGraspListSaving(true);
    setGraspListStatus("Saving...");

    try {
      // Get private key or use NIP-07
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      let privateKey: string | null = null;
      
      if (!hasNip07) {
        // Try to get private key from localStorage
        try {
          const stored = localStorage.getItem("gittr_private_key");
          if (stored) {
            privateKey = stored;
          }
        } catch (e) {
          console.warn("Failed to get private key:", e);
        }
      }

      if (!hasNip07 && !privateKey) {
        throw new Error("No signing method available. Please use NIP-07 extension or set private key.");
      }

      // Create GRASP list event
      const graspListEvent = hasNip07 && window.nostr
        ? await (async () => {
            const { getEventHash } = await import("nostr-tools");
            const signerPubkey = await window.nostr.getPublicKey();
            
            let event: any = {
              kind: KIND_GRASP_LIST,
              created_at: Math.floor(Date.now() / 1000),
              tags: graspListServers.map(server => ["g", server]),
              content: "",
              pubkey: signerPubkey,
              id: "",
              sig: "",
            };
            
            event.id = getEventHash(event);
            event = await window.nostr.signEvent(event);
            return event;
          })()
        : createGraspListEvent(
            { graspServers: graspListServers },
            privateKey!
          );

      // Publish to relays
      if (publish) {
        await publish(graspListEvent, defaultRelays);
        setGraspListStatus("✅ Saved to Nostr!");
        setTimeout(() => setGraspListStatus(""), 3000);
      }
    } catch (error: any) {
      console.error("[GRASP List] Failed to save:", error);
      setGraspListStatus(`Error: ${error.message || "Failed to save"}`);
      setTimeout(() => setGraspListStatus(""), 5000);
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
      alert("This is not a GRASP server. GRASP servers are git servers that also act as Nostr relays.");
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
    setGraspListServers(graspListServers.filter(s => s !== url));
  };

  const renderRelayList = (relays: string[], showRemove: boolean = false) => {
    if (relays.length === 0) return null;
    
    return (
      <div className="space-y-2">
        {relays.map((relay: string) => {
          const connected = isConnected(relay);
          const status = relayStatuses.get(relay);
          return (
            <div key={relay} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded border border-gray-700">
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  connected 
                    ? "bg-violet-500" 
                    : "border-2 border-violet-500 bg-transparent"
                }`}
                title={connected ? "Connected" : "Disconnected"}
              />
              {showRemove && (
                <XIcon
                  className="text-red-400 cursor-pointer hover:text-red-300 flex-shrink-0"
                  onClick={() => handleRemoval(relay)}
                />
              )}
              <p className="ml-1 flex-1 break-all text-sm text-gray-300">{relay}</p>
              <span className={`text-xs px-2 py-1 rounded font-medium ${
                connected 
                  ? "text-green-400 bg-green-900/30" 
                  : status === 1
                  ? "text-yellow-400 bg-yellow-900/30"
                  : "text-red-400 bg-red-900/30"
              }`} title={getStatusLabel(relay)}>
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
                These relays are configured in <code className="bg-gray-800 px-1 rounded">NEXT_PUBLIC_NOSTR_RELAYS</code> and are used for all repository operations.
              </p>
              
              {/* Default Git Servers */}
              {defaultGitServers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-purple-400" />
                    <h4 className="text-xs font-semibold text-gray-400">Git Servers ({defaultGitServers.length})</h4>
                  </div>
                  {renderRelayList(defaultGitServers)}
                </div>
              )}
              
              {/* Default Regular Relays */}
              {defaultRegularRelays.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="h-4 w-4 text-blue-400" />
                    <h4 className="text-xs font-semibold text-gray-400">Relays ({defaultRegularRelays.length})</h4>
                  </div>
                  {renderRelayList(defaultRegularRelays)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* User-Added Relays Section */}
      <div className="mb-6">
        <button
          onClick={() => setUserRelaysExpanded(!userRelaysExpanded)}
          className="flex items-center gap-2 w-full mb-2 font-semibold text-sm text-gray-300 hover:text-gray-200 transition-colors"
        >
          {userRelaysExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span>Your Relays</span>
          <span className="text-xs text-gray-500 ml-auto">
            ({(userRelays || []).length} total)
          </span>
        </button>
        {userRelaysExpanded && (
          <div className="ml-6 space-y-4">
            <p className="text-xs text-gray-500 mb-3">
              Additional relays you've added. These are stored locally and used alongside default relays for metadata fetching and repository operations.
            </p>
            
            <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-3">
              <div>
                <Label htmlFor="relay" className="text-sm text-gray-400">Add relay or git server</Label>
                <Input
                  type="text"
                  id="relay"
                  placeholder="wss://"
                  required
                  pattern="^wss:\/\/.*\..*$"
                  maxLength={80}
                  className="mt-2"
                  {...register("relay")}
                />
              </div>
              <div>
                <Label htmlFor="type" className="text-sm text-gray-400">Type</Label>
                <select
                  id="type"
                  {...register("type")}
                  className="mt-2 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300"
                >
                  <option value="relay">Relay (Nostr only)</option>
                  <option value="gitserver">Git Server (GRASP)</option>
                </select>
              </div>
              <Button
                type="submit"
                className="h-8 !border-[#383B42] bg-[#22262C]"
                variant="outline"
              >
                Add
              </Button>
            </form>
            
            {/* User Git Servers */}
            {userGitServers.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="h-4 w-4 text-purple-400" />
                  <h4 className="text-xs font-semibold text-gray-400">Your Git Servers ({userGitServers.length})</h4>
                </div>
                {renderRelayList(userGitServers.map(r => r.url), true)}
              </div>
            )}
            
            {/* User Regular Relays */}
            {userRegularRelays.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-4 w-4 text-blue-400" />
                  <h4 className="text-xs font-semibold text-gray-400">Your Relays ({userRegularRelays.length})</h4>
                </div>
                {renderRelayList(userRegularRelays.map(r => r.url), true)}
              </div>
            )}
            
            {(userRelays || []).length === 0 && (
              <p className="text-xs text-gray-500 mt-4 italic">No additional relays added yet.</p>
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
              Your preferred GRASP servers for NIP-34 activities (file fetching, PR creation, repository cloning).
              These servers will be prioritized when available. Similar to NIP-65 relay lists.
            </p>
            
            {graspListLoading ? (
              <p className="text-xs text-gray-500 italic">Loading your GRASP list...</p>
            ) : (
              <>
                <div className="space-y-2">
                  {graspListServers.length > 0 ? (
                    graspListServers.map((server, index) => (
                      <div key={server} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded border border-gray-700">
                        <span className="text-xs text-gray-400 w-6">#{index + 1}</span>
                        <p className="flex-1 break-all text-sm text-gray-300">{server}</p>
                        <XIcon
                          className="text-red-400 cursor-pointer hover:text-red-300 flex-shrink-0"
                          onClick={() => removeGraspServer(server)}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500 italic">No preferred GRASP servers set. Using defaults.</p>
                  )}
                </div>

                <div className="space-y-3 border-t border-gray-700 pt-4">
                  <div>
                    <Label htmlFor="grasp-server" className="text-sm text-gray-400">Add GRASP server</Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        type="text"
                        id="grasp-server"
                        placeholder="wss://git.gittr.space"
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
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Only GRASP servers (git servers that are also Nostr relays) can be added.
                    </p>
                  </div>

                  <Button
                    type="button"
                    onClick={saveGraspList}
                    disabled={graspListSaving || !pubkey}
                    className="h-8 !border-[#383B42] bg-[#22262C]"
                    variant="outline"
                  >
                    {graspListSaving ? (
                      <>Saving...</>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save GRASP List to Nostr
                      </>
                    )}
                  </Button>
                  
                  {graspListStatus && (
                    <p className={`text-xs ${graspListStatus.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>
                      {graspListStatus}
                    </p>
                  )}
                  
                  {!pubkey && (
                    <p className="text-xs text-yellow-400">
                      ⚠️ You must be logged in to save your GRASP list to Nostr.
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

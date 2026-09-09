"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import SettingsHero from "@/components/settings-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_SSH_KEY } from "@/lib/nostr/events";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import {
  NO_SIGNING_METHOD_MESSAGE,
  resolveSigningCredentials,
} from "@/lib/nostr/signer";
import useSession from "@/lib/nostr/useSession";
import {
  formatSshKeyContent,
  parseSshPublicKeyLine,
  sshKeyBody,
  sshKeyFingerprintHint,
} from "@/lib/ssh/openssh-public-key";
import { formatDateTime24h } from "@/lib/utils/date-format";

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Github,
  Info,
  Key,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { getEventHash } from "nostr-tools";

interface SSHKey {
  id: string;
  title: string;
  keyType: string;
  publicKey: string;
  fingerprint?: string;
  createdAt: number;
  lastUsed?: number;
}

function sshKeyFromEvent(
  event: {
    id: string;
    content?: string;
    created_at?: number;
    kind?: number;
    pubkey?: string;
    tags?: string[][];
  },
  fingerprintFn: (k: string) => string
): SSHKey | null {
  const tryParseLine = (line: string): SSHKey | null => {
    const content = line.trim();
    const parsed = parseSshPublicKeyLine(content);
    if (!parsed) return null;
    return {
      id: event.id,
      title: parsed.comment || `key-${event.id.slice(0, 8)}`,
      keyType: parsed.keyType,
      publicKey: content,
      fingerprint: fingerprintFn(content),
      createdAt: (event.created_at || 0) * 1000,
    };
  };

  const fromContent = tryParseLine(event.content || "");
  if (fromContent) return fromContent;

  // Some clients put the OpenSSH line in a tag instead of content
  if (Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (!Array.isArray(tag) || tag.length < 2) continue;
      const joined = tag.slice(1).join(" ");
      const parsed = tryParseLine(joined) || tryParseLine(tag[1] || "");
      if (parsed) {
        if (tag.length >= 3 && tag[2]) parsed.title = tag[2];
        return parsed;
      }
    }
  }

  // JSON content fallback
  const raw = (event.content || "").trim();
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as {
        publicKey?: string;
        key?: string;
        sshKey?: string;
        title?: string;
      };
      const line = obj.publicKey || obj.key || obj.sshKey || "";
      const parsed = tryParseLine(line);
      if (parsed && obj.title) parsed.title = String(obj.title);
      return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Git-oriented relays (ngit / gitnostr) often reject bare kind-52 events
 * ("must reference an accepted repository"). Settings list/publish must
 * always include general relays that accept kind 52, or the page looks empty
 * even when keys exist and the bridge already authorized them.
 */
const SSH_KEY_LIST_RELAYS = [
  "wss://relay.gittr.space",
  "wss://relay.damus.io",
  "wss://nos.lol",
] as const;

function relaysForSshKeys(defaultRelays: string[]): string[] {
  return Array.from(
    new Set([...getAllRelays(defaultRelays), ...SSH_KEY_LIST_RELAYS])
  );
}

function mergeSshKeys(local: SSHKey[], fromRelays: SSHKey[]): SSHKey[] {
  const byBody = new Map<string, SSHKey>();
  for (const k of [...fromRelays, ...local]) {
    const body = sshKeyBody(k.publicKey);
    const prev = byBody.get(body);
    if (!prev || (k.createdAt || 0) >= (prev.createdAt || 0)) {
      byBody.set(body, k);
    }
  }
  return Array.from(byBody.values()).sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}

export default function SSHKeysPage() {
  const { pubkey, publish, subscribe, defaultRelays, remoteSigner } =
    useNostrContext();
  const { isLoggedIn } = useSession();
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [publicKeyInput, setPublicKeyInput] = useState("");
  const [keyTitle, setKeyTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [addingKey, setAddingKey] = useState(false);
  const addFormRef = useRef<HTMLDivElement | null>(null);
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState<string | null>(
    null
  );
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(
    null
  );
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubKeySuggestions, setGithubKeySuggestions] = useState<
    Array<{ key: string; title?: string }>
  >([]);
  // Use ref to track connecting state for closure access
  const githubConnectingRef = useRef(false);
  // Store popup check interval ID to clear it when message is received
  const popupCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!showAddForm) return;
    addFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
    document.getElementById("public-key")?.focus();
  }, [showAddForm]);

  // Load SSH keys from relays (kind 52) + localStorage cache
  const loadKeys = useCallback(async () => {
    if (!pubkey) return;

    setLoading(true);
    try {
      const stored = JSON.parse(
        localStorage.getItem(`gittr_ssh_keys_${pubkey}`) || "[]"
      ) as SSHKey[];
      // Optimistic: show local cache immediately
      setKeys(stored);

      if (!subscribe) {
        setLoading(false);
        return;
      }

      const relays = relaysForSshKeys(defaultRelays);
      const collected = new Map<string, SSHKey>();
      await new Promise<void>((resolve) => {
        let settled = false;
        let eoseCount = 0;
        const expectedEose = Math.max(relays.length, 1);
        // First empty relay must not abort — wait for a small quorum or timeout
        const eoseQuorum = Math.min(3, expectedEose);
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const maybeFinishEarly = () => {
          if (
            eoseCount >= expectedEose ||
            (collected.size > 0 && eoseCount >= eoseQuorum)
          ) {
            clearTimeout(timeout);
            finish();
          }
        };
        const timeout = setTimeout(finish, 6000);
        try {
          subscribe(
            [{ kinds: [KIND_SSH_KEY], authors: [pubkey], limit: 50 }],
            relays,
            (event) => {
              if (event.kind !== KIND_SSH_KEY) return;
              if (event.pubkey?.toLowerCase() !== pubkey.toLowerCase()) return;
              const parsed = sshKeyFromEvent(event, sshKeyFingerprintHint);
              if (parsed) {
                collected.set(parsed.id, parsed);
                // Event may arrive after empty git-relay EOSEs — finish once
                // we have keys and a quorum, without waiting for another EOSE.
                maybeFinishEarly();
              }
            },
            undefined,
            () => {
              eoseCount += 1;
              maybeFinishEarly();
            },
            {}
          );
        } catch (e) {
          console.warn("[SSH Keys] Relay subscribe failed:", e);
          clearTimeout(timeout);
          finish();
        }
      });

      const merged = mergeSshKeys(stored, Array.from(collected.values()));
      setKeys(merged);
      try {
        localStorage.setItem(
          `gittr_ssh_keys_${pubkey}`,
          JSON.stringify(merged)
        );
      } catch {
        /* ignore quota */
      }
    } catch (error: any) {
      console.error("Error loading SSH keys:", error);
      setError("Failed to load SSH keys");
    } finally {
      setLoading(false);
    }
  }, [pubkey, subscribe, defaultRelays]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void loadKeys();

    // Listen for new SSH key events
    const handleKeyAdded = () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      void loadKeys();
    };
    window.addEventListener("gittr:ssh-key-added", handleKeyAdded);

    return () => {
      window.removeEventListener("gittr:ssh-key-added", handleKeyAdded);
    };
  }, [loadKeys]);

  // Check GitHub connection status
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkGitHubStatus = () => {
      // Check for success parameter from OAuth callback (fallback when parent window was unavailable)
      const urlParams = new URLSearchParams(window.location.search);
      const isFallbackSuccess =
        urlParams.get("success") === "true" &&
        urlParams.get("fallback") === "localStorage";

      if (isFallbackSuccess) {
        // OAuth completed but parent window was unavailable - token should be in localStorage
        console.log("[SSH Keys] OAuth completed via localStorage fallback");
        // Remove the query params to clean up URL
        window.history.replaceState({}, "", window.location.pathname);
      }

      const githubToken = localStorage.getItem("gittr_github_token");
      const githubProfile = localStorage.getItem("gittr_github_profile");

      if (githubToken && githubProfile) {
        setGithubConnected(true);
        try {
          const profile = JSON.parse(githubProfile);
          setGithubUsername(profile.githubUsername || null);
          // Show success message if we just completed OAuth via fallback
          if (isFallbackSuccess) {
            setStatus("GitHub connected successfully!");
            setTimeout(() => setStatus(""), 3000);
          }
        } catch {
          // Try to extract username from URL
          try {
            const url = new URL(githubProfile);
            const pathParts = url.pathname.split("/").filter((p) => p);
            setGithubUsername(pathParts[0] || null);
          } catch {
            setGithubUsername(null);
          }
        }
      } else {
        setGithubConnected(false);
        setGithubUsername(null);
      }
    };

    // Check immediately
    checkGitHubStatus();

    // Listen for storage events (when localStorage changes in another tab/window)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "gittr_github_token" || e.key === "gittr_github_profile") {
        console.log(
          "[SSH Keys] GitHub token storage changed, re-checking status"
        );
        checkGitHubStatus();
      }
    };

    window.addEventListener("storage", handleStorageChange);

    // Also listen for custom event from same-window localStorage changes (popup -> parent)
    const handleLocalStorageChange = () => {
      console.log(
        "[SSH Keys] LocalStorage change detected, re-checking GitHub status"
      );
      checkGitHubStatus();
    };

    // Poll localStorage periodically when connecting (in case postMessage fails)
    let pollInterval: NodeJS.Timeout | null = null;
    if (githubConnectingRef.current) {
      pollInterval = setInterval(() => {
        const token = localStorage.getItem("gittr_github_token");
        if (token && githubConnectingRef.current) {
          console.log(
            "[SSH Keys] Token found in localStorage during connection, updating status"
          );
          checkGitHubStatus();
          setGithubConnecting(false);
          githubConnectingRef.current = false;
          if (pollInterval) clearInterval(pollInterval);
        }
      }, 500);
    }

    // Listen for OAuth callback messages
    const handleOAuthMessage = (event: MessageEvent) => {
      console.log("[SSH Keys] Message received:", {
        origin: event.origin,
        expectedOrigin: window.location.origin,
        type: event.data?.type,
      });
      if (event.origin !== window.location.origin) {
        console.warn(
          "[SSH Keys] Origin mismatch:",
          event.origin,
          "!==",
          window.location.origin
        );
        return;
      }
      if (event.data?.type !== "GITHUB_OAUTH_CALLBACK") {
        console.log("[SSH Keys] Not OAuth message, ignoring");
        return;
      }
      console.log("[SSH Keys] Processing OAuth callback message");

      const {
        success,
        accessToken,
        githubUsername,
        githubUrl,
        error,
        errorDescription,
        state,
      } = event.data;

      if (error) {
        // Clear popup check interval on error
        if (popupCheckIntervalRef.current) {
          clearInterval(popupCheckIntervalRef.current);
          popupCheckIntervalRef.current = null;
        }
        setStatus(`GitHub OAuth error: ${errorDescription || error}`);
        setGithubConnecting(false);
        githubConnectingRef.current = false;
        setTimeout(() => setStatus(""), 5000);
        return;
      }

      // Verify state token against sessionStorage (CRITICAL for CSRF protection)
      // If state is provided, storedState MUST exist and match - reject if missing or mismatched
      if (state) {
        const storedState = sessionStorage.getItem("github_oauth_state");

        // SECURITY: Reject if storedState is missing (sessionStorage unavailable/cleared/private browsing)
        // This prevents CSRF attacks where attacker sends postMessage without valid state
        if (!storedState) {
          console.error(
            "[SSH Keys] State token missing from sessionStorage - possible CSRF attack or session cleared"
          );
          // Clear popup check interval on state verification failure
          if (popupCheckIntervalRef.current) {
            clearInterval(popupCheckIntervalRef.current);
            popupCheckIntervalRef.current = null;
          }
          setStatus(
            "GitHub OAuth error: State token verification failed (session may have expired)"
          );
          setGithubConnecting(false);
          githubConnectingRef.current = false;
          setTimeout(() => setStatus(""), 5000);
          return;
        }

        // SECURITY: Reject if state doesn't match stored state
        if (storedState !== state) {
          console.error(
            "[SSH Keys] State token mismatch - possible CSRF attack"
          );
          // Clear popup check interval on state mismatch
          if (popupCheckIntervalRef.current) {
            clearInterval(popupCheckIntervalRef.current);
            popupCheckIntervalRef.current = null;
          }
          setStatus("GitHub OAuth error: State token mismatch");
          setGithubConnecting(false);
          githubConnectingRef.current = false;
          setTimeout(() => setStatus(""), 5000);
          sessionStorage.removeItem("github_oauth_state");
          return;
        }

        // State verified successfully - remove it (one-time use)
        sessionStorage.removeItem("github_oauth_state");
      } else {
        // SECURITY: If no state provided but we're expecting one, reject
        // This handles cases where state should exist but wasn't sent
        const storedState = sessionStorage.getItem("github_oauth_state");
        if (storedState) {
          console.error(
            "[SSH Keys] State token expected but not provided in message"
          );
          // Clear popup check interval on state verification failure
          if (popupCheckIntervalRef.current) {
            clearInterval(popupCheckIntervalRef.current);
            popupCheckIntervalRef.current = null;
          }
          setStatus("GitHub OAuth error: State token missing from callback");
          setGithubConnecting(false);
          githubConnectingRef.current = false;
          setTimeout(() => setStatus(""), 5000);
          sessionStorage.removeItem("github_oauth_state");
          return;
        }
      }

      // Clear popup check interval since we received the message
      if (popupCheckIntervalRef.current) {
        clearInterval(popupCheckIntervalRef.current);
        popupCheckIntervalRef.current = null;
      }

      if (success && accessToken && githubUsername) {
        localStorage.setItem("gittr_github_token", accessToken);
        localStorage.setItem(
          "gittr_github_profile",
          JSON.stringify({
            githubUsername,
            githubUrl,
          })
        );

        setGithubConnected(true);
        setGithubUsername(githubUsername);
        setStatus("GitHub connected successfully!");
        window.dispatchEvent(
          new CustomEvent("gittr:github-connected", {
            detail: { username: githubUsername, githubUrl },
          })
        );
        setTimeout(() => setStatus(""), 3000);
      } else {
        setStatus("GitHub OAuth failed: Missing data");
        setTimeout(() => setStatus(""), 5000);
      }

      setGithubConnecting(false);
      githubConnectingRef.current = false;
    };

    window.addEventListener("message", handleOAuthMessage);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("message", handleOAuthMessage);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []); // Empty deps - we check localStorage and listen for messages

  // Suggest public SSH keys from connected GitHub account (api.github.com/users/…/keys)
  useEffect(() => {
    if (!githubUsername) {
      setGithubKeySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const endpoint = `/users/${encodeURIComponent(githubUsername)}/keys`;
        const res = await fetch(
          `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Array<{
          key?: string;
          title?: string;
          id?: number;
        }>;
        if (!Array.isArray(data) || cancelled) return;
        setGithubKeySuggestions(
          data
            .filter((k) => typeof k.key === "string" && k.key.trim())
            .map((k) => ({
              key: k.key!.trim(),
              title: k.title || `github-${k.id ?? "key"}`,
            }))
        );
      } catch (e) {
        console.warn("[SSH Keys] Failed to load GitHub key suggestions:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [githubUsername]);

  // Generate SSH key pair (client-side using Web Crypto API)
  const generateKeyPair = useCallback(async () => {
    setError(null);
    setStatus("Generating SSH key pair...");

    try {
      // Web Crypto API can generate Ed25519 keys
      // Note: We can't generate RSA keys in the browser, only Ed25519
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "Ed25519",
          namedCurve: "Ed25519",
        },
        true, // extractable
        ["sign", "verify"]
      );

      // Export private key (PEM format for Ed25519)
      const privateKeyPkcs8 = await window.crypto.subtle.exportKey(
        "pkcs8",
        keyPair.privateKey
      );
      const privateKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(privateKeyPkcs8))
      );

      // Export public key (SPKI format)
      const publicKeySpki = await window.crypto.subtle.exportKey(
        "spki",
        keyPair.publicKey
      );
      const publicKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(publicKeySpki))
      );

      // Format as OpenSSH public key
      // Note: This is a simplified conversion - proper OpenSSH format conversion requires additional libraries
      const publicKeyFormatted = `ssh-ed25519 ${publicKeyBase64} ${
        generatedTitle || `gittr-space-${Date.now()}`
      }`;

      setGeneratedPublicKey(publicKeyFormatted);
      setGeneratedPrivateKey(
        `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64}\n-----END PRIVATE KEY-----`
      );
      setStatus(
        "Key generated! Download your private key before adding the public key."
      );
    } catch (error: any) {
      console.error("Error generating key:", error);
      // Fallback: Provide instructions for manual generation
      setError(
        "Browser key generation not fully supported. Please generate keys using: ssh-keygen -t ed25519 -C 'your-email@example.com'"
      );
      setGeneratedPublicKey(null);
      setGeneratedPrivateKey(null);
    }
  }, [generatedTitle]);

  // Add SSH key (paste or upload)
  const handleAddKey = useCallback(async () => {
    if (!pubkey || !publish) {
      setError("Please log in to add SSH keys");
      return;
    }

    if (!publicKeyInput.trim()) {
      setError("Please paste or upload your public SSH key");
      return;
    }

    setError(null);
    setAddingKey(true);
    setStatus(
      remoteSigner?.getSession() ? "Waiting for signer…" : "Adding SSH key..."
    );

    try {
      const { keyType, keyContent, title } = formatSshKeyContent(
        publicKeyInput,
        {
          title: keyTitle,
          fallbackTitle: `gittr-space-${Date.now()}`,
        }
      );

      const signingCreds = await resolveSigningCredentials({
        remoteSigner,
        maxWaitMs: 30_000,
      });
      if (!signingCreds) {
        setError(NO_SIGNING_METHOD_MESSAGE);
        setStatus("");
        return;
      }
      const { signer } = signingCreds;
      const signerPubkey = await signer.getPublicKey();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let sshKeyEvent: any = {
        kind: KIND_SSH_KEY,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: keyContent,
        pubkey: signerPubkey,
        id: "",
        sig: "",
      };
      sshKeyEvent.id = getEventHash(sshKeyEvent);
      sshKeyEvent = await signer.signEvent(sshKeyEvent);

      const publishRelays = relaysForSshKeys(defaultRelays);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      void publish(sshKeyEvent, publishRelays);

      // Send directly to the bridge so authorized_keys updates without waiting
      // on relays (git relays often reject bare kind 52).
      try {
        const bridgeResponse = await fetch("/api/nostr/repo/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sshKeyEvent),
        });
        if (bridgeResponse.ok) {
          console.log(
            `✅ [SSH Keys] SSH key event sent directly to bridge: ${sshKeyEvent.id.slice(
              0,
              16
            )}...`
          );
        } else {
          console.warn(
            `⚠️ [SSH Keys] Bridge API returned ${bridgeResponse.status} for SSH key event - bridge will receive via relay subscription`
          );
        }
      } catch (bridgeError: any) {
        console.warn(
          `⚠️ [SSH Keys] Failed to send SSH key event to bridge API (will receive via relay):`,
          bridgeError?.message
        );
      }

      const newKey: SSHKey = {
        id: sshKeyEvent.id,
        title,
        keyType,
        publicKey: keyContent,
        fingerprint: sshKeyFingerprintHint(keyContent),
        createdAt: Date.now(),
      };

      const stored = JSON.parse(
        localStorage.getItem(`gittr_ssh_keys_${pubkey}`) || "[]"
      );
      stored.push(newKey);
      localStorage.setItem(`gittr_ssh_keys_${pubkey}`, JSON.stringify(stored));

      setKeys(stored);
      setStatus(
        "SSH key added successfully! Published to Nostr relays and sent to the git host. If a relay rejects kind 52, the key can still work via the direct bridge POST."
      );
      setShowAddForm(false);
      setPublicKeyInput("");
      setKeyTitle("");

      window.dispatchEvent(
        new CustomEvent("gittr:ssh-key-added", { detail: newKey })
      );
    } catch (error: any) {
      console.error("Error adding SSH key:", error);
      let errorMsg = error.message || "Failed to add SSH key";
      if (
        errorMsg.includes("rejected") ||
        errorMsg.includes("blocked") ||
        errorMsg.includes("kind")
      ) {
        errorMsg +=
          ". Note: Some relays may reject KIND_52 (conflicts with NIP-52 Calendar Events). Try a different relay or check relay logs.";
      }
      setError(errorMsg);
      setStatus("");
    } finally {
      setAddingKey(false);
    }
  }, [pubkey, publish, defaultRelays, publicKeyInput, keyTitle, remoteSigner]);

  // Delete SSH key
  const handleDeleteKey = useCallback(
    async (keyId: string) => {
      if (
        !confirm(
          "Are you sure you want to delete this SSH key? You won't be able to use it for Git operations."
        )
      ) {
        return;
      }

      try {
        const stored = JSON.parse(
          localStorage.getItem(`gittr_ssh_keys_${pubkey}`) || "[]"
        ) as SSHKey[];
        const keyToDelete = stored.find((k) => k.id === keyId);

        if (!keyToDelete) {
          setError("SSH key not found");
          return;
        }

        let revokedOnNostr = false;
        if (pubkey && publish && defaultRelays && defaultRelays.length > 0) {
          const signingCreds = await resolveSigningCredentials({
            remoteSigner,
            maxWaitMs: 30_000,
          });
          if (!signingCreds) {
            setError(NO_SIGNING_METHOD_MESSAGE);
            return;
          }
          const { signer } = signingCreds;
          const authorPubkey = await signer.getPublicKey();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let deletionEvent: any = {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["e", keyToDelete.id],
              ["key", keyToDelete.publicKey],
              ["reason", "SSH key revocation"],
            ],
            content: `Revoked SSH key: ${keyToDelete.title || keyToDelete.id}`,
            pubkey: authorPubkey,
            id: "",
            sig: "",
          };
          deletionEvent.id = getEventHash(deletionEvent);
          deletionEvent = await signer.signEvent(deletionEvent);
          publish(deletionEvent, defaultRelays);
          revokedOnNostr = true;
        }

        const filtered = stored.filter((k) => k.id !== keyId);
        localStorage.setItem(
          `gittr_ssh_keys_${pubkey}`,
          JSON.stringify(filtered)
        );
        setKeys(filtered);

        setStatus(
          "SSH key deleted" + (revokedOnNostr ? " and revoked on Nostr" : "")
        );
        setTimeout(() => setStatus(""), 3000);
      } catch (error: any) {
        setError(error?.message || "Failed to delete SSH key");
        console.error("Error deleting SSH key:", error);
      }
    },
    [pubkey, publish, defaultRelays, remoteSigner]
  );

  // Copy public key to clipboard
  const copyPublicKey = useCallback(async (publicKey: string) => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setStatus("Public key copied to clipboard!");
      setTimeout(() => setStatus(""), 2000);
    } catch (error) {
      setError("Failed to copy to clipboard");
    }
  }, []);

  // Download private key
  const downloadPrivateKey = useCallback(
    (privateKey: string, title: string) => {
      const blob = new Blob([privateKey], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gittr_${title}_private_key`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Private key downloaded. Keep it secure and never share it!");
      setTimeout(() => setStatus(""), 3000);
    },
    []
  );

  if (!mounted) {
    return (
      <div className="p-6">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="p-6">
        <p className="text-gray-400">Please log in to manage SSH keys.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6" />
            SSH Keys
          </h1>

          {/* Important clarification */}
          <div className="mt-4 mb-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded text-yellow-400 max-w-2xl">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div className="text-sm min-w-0">
                <p className="font-semibold mb-2">When Do You Need SSH Keys?</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>
                    <strong>Web UI operations</strong> (Push to Nostr, PRs,
                    Issues) publish <strong>NIP‑34 events</strong> via your
                    Nostr key (NIP‑07 / Amber or nsec).{" "}
                    <strong>No SSH key required.</strong>
                  </li>
                  <li>
                    <strong>
                      <code className="bg-yellow-900/50 px-1 rounded">
                        git@git.gittr.space
                      </code>{" "}
                      (SSH)
                    </strong>{" "}
                    needs a kind‑52 key once (this page, or{" "}
                    <code className="bg-yellow-900/50 px-1 rounded">
                      gn ssh-key add
                    </code>
                    ). After that, clone/push never go through this website.
                  </li>
                  <li>
                    <strong>gittr-mcp / HTTPS git</strong> uses Nostr auth
                    headers, <strong>not SSH</strong>. Agents can skip this
                    page.
                  </li>
                  <li>
                    If you stay in the browser and let us publish NIP‑34 events
                    for you, you can skip SSH keys entirely.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <p className="text-gray-400 mt-1 text-sm sm:text-base">
            Manage SSH keys for command-line Git operations over SSH. Keys are
            published to Nostr (Kind 52) and used by the git-nostr-bridge when
            you run <code className="bg-gray-800 px-1 rounded">git clone</code>,{" "}
            <code className="bg-gray-800 px-1 rounded">git push</code>, or{" "}
            <code className="bg-gray-800 px-1 rounded">git pull</code> against{" "}
            <code className="bg-gray-800 px-1 rounded">git.gittr.space</code> or
            other GRASP servers.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            onClick={() => {
              setShowAddForm(true);
              setShowGenerateForm(false);
              setError(null);
              setStatus("");
            }}
            className="flex-1 sm:flex-none"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Key
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div
          ref={addFormRef}
          id="add-ssh-key-form"
          className="mb-6 border border-[#383B42] rounded p-6 bg-[#171B21]"
        >
          <h2 className="text-lg font-semibold mb-4">Add SSH Key</h2>

          <div className="space-y-4">
            <div>
              <Label htmlFor="public-key">Public Key</Label>
              <Textarea
                id="public-key"
                value={publicKeyInput}
                onChange={(e) => setPublicKeyInput(e.target.value)}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... My Key"
                rows={3}
                className="bg-[#0E1116] border-[#383B42] text-white font-mono text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                Paste your public SSH key here (from ~/.ssh/id_*.pub). Then
                approve the Nostr signature in your extension or Amber.
              </p>
            </div>

            {githubKeySuggestions.length > 0 && (
              <div className="rounded border border-[#383B42] bg-[#0E1116] p-3">
                <p className="mb-2 text-xs font-medium text-gray-300">
                  From GitHub ({githubUsername}) — click to fill
                </p>
                <ul className="space-y-2">
                  {githubKeySuggestions.map((sug, i) => {
                    const already = keys.some(
                      (k) => sshKeyBody(k.publicKey) === sshKeyBody(sug.key)
                    );
                    return (
                      <li key={`${sug.title}-${i}`}>
                        <button
                          type="button"
                          disabled={already}
                          onClick={() => {
                            setPublicKeyInput(sug.key);
                            if (sug.title) setKeyTitle(sug.title);
                          }}
                          className="w-full rounded border border-[#383B42] px-3 py-2 text-left text-xs hover:border-purple-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span className="font-mono text-gray-300">
                            {sug.key.slice(0, 48)}…
                          </span>
                          {sug.title ? (
                            <span className="mt-1 block text-gray-500">
                              {sug.title}
                              {already ? " (already added)" : ""}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div>
              <Label htmlFor="key-title">Key Title (optional)</Label>
              <Input
                id="key-title"
                value={keyTitle}
                onChange={(e) => setKeyTitle(e.target.value)}
                placeholder="My Laptop Key"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleAddKey}
                disabled={!publicKeyInput.trim() || addingKey}
              >
                {addingKey ? status || "Adding…" : "Add SSH Key"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAddForm(false);
                  setPublicKeyInput("");
                  setKeyTitle("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-700 rounded text-red-400">
          {error}
        </div>
      )}

      {status && (
        <div className="mb-4 p-4 bg-purple-900/20 border border-purple-700 rounded text-purple-400">
          {status}
        </div>
      )}

      {/* GitHub OAuth Section - Moved above SSH Keys */}
      <div className="mb-6 p-4 bg-[#171B21] border border-[#383B42] rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            <h2 className="text-lg font-semibold">GitHub Authentication</h2>
          </div>
          {githubConnected ? (
            <Badge className="bg-green-900/30 text-green-400 border-green-700">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge className="bg-gray-900/30 text-gray-400 border-gray-700">
              <XCircle className="h-3 w-3 mr-1" />
              Not Connected
            </Badge>
          )}
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Connect your GitHub account to import and access private repositories.
          The OAuth token is stored locally in your browser and used for GitHub
          API requests.
        </p>

        {githubConnected && githubUsername ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-300">Connected as:</span>
              <a
                href={`https://github.com/${githubUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Github className="h-4 w-4" />
                {githubUsername}
              </a>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                localStorage.removeItem("gittr_github_token");
                localStorage.removeItem("gittr_github_profile");
                setGithubConnected(false);
                setGithubUsername(null);
                setStatus("GitHub disconnected");
                setTimeout(() => setStatus(""), 3000);
              }}
              className="text-red-400 border-red-700 hover:bg-red-900/20"
            >
              Disconnect GitHub
            </Button>
          </div>
        ) : (
          <Button
            onClick={async () => {
              setGithubConnecting(true);
              githubConnectingRef.current = true;
              setError(null);
              try {
                const response = await fetch(
                  "/api/github/auth?action=initiate",
                  {
                    method: "GET",
                  }
                );

                if (!response.ok) {
                  const errorData = await response.json();
                  throw new Error(
                    errorData.error || "Failed to initiate OAuth"
                  );
                }

                const data = await response.json();

                // Store state in sessionStorage for verification (cookie might not be available in popup)
                if (data.state) {
                  sessionStorage.setItem("github_oauth_state", data.state);
                }

                // Open OAuth popup
                const width = 600;
                const height = 700;
                const left = window.screen.width / 2 - width / 2;
                const top = window.screen.height / 2 - height / 2;

                console.log("[SSH Keys] Opening OAuth popup:", data.authUrl);
                const popup = window.open(
                  data.authUrl,
                  "GitHub OAuth",
                  `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
                );

                if (!popup) {
                  setError(
                    "Popup was blocked. Please allow popups for this site and try again."
                  );
                  setGithubConnecting(false);
                  githubConnectingRef.current = false;
                  return;
                }

                console.log("[SSH Keys] Popup opened, waiting for message...");

                // Clear any existing interval
                if (popupCheckIntervalRef.current) {
                  clearInterval(popupCheckIntervalRef.current);
                }

                // Fallback: reset connecting state if popup is closed without message
                popupCheckIntervalRef.current = setInterval(() => {
                  if (popup?.closed) {
                    if (popupCheckIntervalRef.current) {
                      clearInterval(popupCheckIntervalRef.current);
                      popupCheckIntervalRef.current = null;
                    }
                    console.log(
                      "[SSH Keys] Popup closed, waiting for message..."
                    );
                    // Give it more time for message to arrive (popup might close before message is processed)
                    setTimeout(() => {
                      // Use ref to check current state (avoids closure issue)
                      if (githubConnectingRef.current) {
                        console.log(
                          "[SSH Keys] No message received after popup closed, resetting connecting state"
                        );
                        setGithubConnecting(false);
                        githubConnectingRef.current = false;
                        setStatus("GitHub connection timed out or cancelled.");
                        setTimeout(() => setStatus(""), 5000);
                      }
                    }, 3000); // Increased to 3 seconds to give message more time
                  }
                }, 500);

                // Clean up interval after 5 minutes as safety
                setTimeout(() => {
                  if (popupCheckIntervalRef.current) {
                    clearInterval(popupCheckIntervalRef.current);
                    popupCheckIntervalRef.current = null;
                  }
                }, 300000);
              } catch (error: any) {
                setError(`Failed to connect GitHub: ${error.message}`);
                setGithubConnecting(false);
                githubConnectingRef.current = false;
              }
            }}
            disabled={githubConnecting}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {githubConnecting ? "Connecting..." : "Connect GitHub"}
          </Button>
        )}
      </div>

      {/* Info box */}
      <div className="mb-6 p-4 bg-blue-900/20 border border-blue-700 rounded text-blue-400 max-w-2xl">
        <div className="flex items-start gap-2">
          <Info className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div className="text-sm min-w-0 flex-1">
            <p className="font-semibold mb-1">How SSH Keys Work</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>
                SSH keys are for <strong>git clone/push over SSH</strong> to{" "}
                <code className="text-xs">git.gittr.space</code> (kind 52 →
                bridge <code className="text-xs">authorized_keys</code>). They
                are <strong>not</strong> related to GitHub OAuth on this page.
              </li>
              <li>
                This page lists kind-52 events from your relays (plus a local
                cache). Keys you published from another device should appear
                after a short relay query.
              </li>
              <li>
                <code className="text-xs">git.gittr.space</code> is the{" "}
                <strong>git host</strong> (SSH/HTTPS), not a Nostr relay —{" "}
                <code className="text-xs">wss://git.gittr.space</code> returning
                404 is expected.
              </li>
              <li>
                Paste a real OpenSSH public key from{" "}
                <code className="text-xs">~/.ssh/id_ed25519.pub</code> (or use{" "}
                <code className="text-xs">gn ssh-key add</code>). Browser
                &quot;generate&quot; is disabled — WebCrypto SPKI is not OpenSSH
                wire format.
              </li>
              <li className="text-yellow-400">
                Note: KIND_52 conflicts with NIP-52 (Calendar Events). Most
                relays accept it, but some may reject. If publishing fails, try
                a different relay.
              </li>
              <li>
                If <code className="text-xs">git clone git@…</code> asks for a
                password after you added a key, your client is not using the
                right private key — try{" "}
                <code className="text-xs">
                  GIT_SSH_COMMAND=&apos;ssh -o IdentitiesOnly=yes -i
                  ~/.ssh/your_key&apos; git clone …
                </code>{" "}
                or use <code className="text-xs">git-nostr@</code> instead of{" "}
                <code className="text-xs">git@</code> (see Help → SSH Keys).
              </li>
              <li>
                <strong>GitHub Authentication</strong> on this page is only for
                importing private GitHub repos / API rate limits — it does not
                unlock gittr SSH.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Browser generate removed: WebCrypto SPKI ≠ OpenSSH public key format */}
      {showGenerateForm && (
        <div className="mb-6 border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h2 className="text-lg font-semibold mb-2">Generate keys locally</h2>
          <p className="text-sm text-gray-400 mb-4">
            Run{" "}
            <code className="bg-gray-800 px-1 rounded text-xs">
              ssh-keygen -t ed25519 -C &quot;gittr&quot;
            </code>{" "}
            then paste{" "}
            <code className="bg-gray-800 px-1 rounded text-xs">
              ~/.ssh/id_ed25519.pub
            </code>{" "}
            via <strong>Add Key</strong>.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowGenerateForm(false);
              setShowAddForm(true);
            }}
          >
            Add Key instead
          </Button>
        </div>
      )}

      {/* SSH Keys List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Your SSH Keys</h2>

        {loading ? (
          <p className="text-gray-400">Loading SSH keys...</p>
        ) : keys.length === 0 ? (
          <div className="border border-[#383B42] rounded p-8 text-center bg-[#171B21]">
            <Key className="h-12 w-12 mx-auto mb-4 text-gray-500" />
            <p className="text-gray-400 mb-4">No SSH keys found yet.</p>
            <p className="text-sm text-gray-500">
              Add an OpenSSH public key (or wait for relays if you already
              published kind 52 elsewhere). Keys enable git clone/push over SSH.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="border border-[#383B42] rounded p-4 bg-[#171B21]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Key className="h-5 w-5 text-purple-500" />
                      <h3 className="font-semibold">{key.title}</h3>
                      <Badge
                        variant="outline"
                        className="border-purple-700 text-purple-400 bg-purple-900/20"
                      >
                        {key.keyType}
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-400 space-y-1">
                      <p>Fingerprint: {key.fingerprint || "Unknown"}</p>
                      <p>Added: {formatDateTime24h(key.createdAt)}</p>
                      {key.lastUsed && (
                        <p>Last used: {formatDateTime24h(key.lastUsed)}</p>
                      )}
                    </div>
                    <div className="mt-3">
                      <code className="text-xs bg-[#0E1116] p-2 rounded block break-all">
                        {key.publicKey}
                      </code>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyPublicKey(key.publicKey)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteKey(key.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

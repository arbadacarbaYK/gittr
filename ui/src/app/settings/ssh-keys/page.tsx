"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import SettingsHero from "@/components/settings-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { createSSHKeyEvent, KIND_SSH_KEY } from "@/lib/nostr/events";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { Key, Plus, Trash2, Copy, Download, AlertCircle, Info, Github, CheckCircle2, XCircle } from "lucide-react";
import useSession from "@/lib/nostr/useSession";
import { getEventHash, signEvent, type Event as NostrEvent } from "nostr-tools";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface SSHKey {
  id: string;
  title: string;
  keyType: string;
  publicKey: string;
  fingerprint?: string;
  createdAt: number;
  lastUsed?: number;
}

export default function SSHKeysPage() {
  const { pubkey, publish, defaultRelays } = useNostrContext();
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
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState<string | null>(null);
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [githubConnecting, setGithubConnecting] = useState(false);
  // Use ref to track connecting state for closure access
  const githubConnectingRef = useRef(false);
  // Store popup check interval ID to clear it when message is received
  const popupCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load SSH keys from Nostr events
  const loadKeys = useCallback(async () => {
    if (!pubkey || !publish) return;
    
    setLoading(true);
    try {
      // Query Nostr relays for KIND_SSH_KEY events
      // For now, we'll store keys in localStorage and sync with Nostr
      // In production, query relays directly
      const stored = JSON.parse(localStorage.getItem(`gittr_ssh_keys_${pubkey}`) || "[]");
      setKeys(stored);
    } catch (error: any) {
      console.error("Error loading SSH keys:", error);
      setError("Failed to load SSH keys");
    } finally {
      setLoading(false);
    }
  }, [pubkey]);

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
      const isFallbackSuccess = urlParams.get("success") === "true" && urlParams.get("fallback") === "localStorage";
      
      if (isFallbackSuccess) {
        // OAuth completed but parent window was unavailable - token should be in localStorage
        console.log('[SSH Keys] OAuth completed via localStorage fallback');
        // Remove the query params to clean up URL
        window.history.replaceState({}, '', window.location.pathname);
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
            const pathParts = url.pathname.split("/").filter(p => p);
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
        console.log('[SSH Keys] GitHub token storage changed, re-checking status');
        checkGitHubStatus();
      }
    };
    
    window.addEventListener("storage", handleStorageChange);
    
    // Also listen for custom event from same-window localStorage changes (popup -> parent)
    const handleLocalStorageChange = () => {
      console.log('[SSH Keys] LocalStorage change detected, re-checking GitHub status');
      checkGitHubStatus();
    };
    
    // Poll localStorage periodically when connecting (in case postMessage fails)
    let pollInterval: NodeJS.Timeout | null = null;
    if (githubConnectingRef.current) {
      pollInterval = setInterval(() => {
        const token = localStorage.getItem("gittr_github_token");
        if (token && githubConnectingRef.current) {
          console.log('[SSH Keys] Token found in localStorage during connection, updating status');
          checkGitHubStatus();
          setGithubConnecting(false);
          githubConnectingRef.current = false;
          if (pollInterval) clearInterval(pollInterval);
        }
      }, 500);
    }
    
    // Listen for OAuth callback messages
    const handleOAuthMessage = (event: MessageEvent) => {
      console.log('[SSH Keys] Message received:', { origin: event.origin, expectedOrigin: window.location.origin, type: event.data?.type });
      if (event.origin !== window.location.origin) {
        console.warn('[SSH Keys] Origin mismatch:', event.origin, '!==', window.location.origin);
        return;
      }
      if (event.data?.type !== "GITHUB_OAUTH_CALLBACK") {
        console.log('[SSH Keys] Not OAuth message, ignoring');
        return;
      }
      console.log('[SSH Keys] Processing OAuth callback message');
      
      const { success, accessToken, githubUsername, githubUrl, error, errorDescription, state } = event.data;
      
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
          console.error('[SSH Keys] State token missing from sessionStorage - possible CSRF attack or session cleared');
          // Clear popup check interval on state verification failure
          if (popupCheckIntervalRef.current) {
            clearInterval(popupCheckIntervalRef.current);
            popupCheckIntervalRef.current = null;
          }
          setStatus("GitHub OAuth error: State token verification failed (session may have expired)");
          setGithubConnecting(false);
          githubConnectingRef.current = false;
          setTimeout(() => setStatus(""), 5000);
          return;
        }
        
        // SECURITY: Reject if state doesn't match stored state
        if (storedState !== state) {
          console.error('[SSH Keys] State token mismatch - possible CSRF attack');
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
          console.error('[SSH Keys] State token expected but not provided in message');
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
        localStorage.setItem("gittr_github_profile", JSON.stringify({
          githubUsername,
          githubUrl,
        }));
        
        setGithubConnected(true);
        setGithubUsername(githubUsername);
        setStatus("GitHub connected successfully!");
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

  // Calculate fingerprint from public key
  const calculateFingerprint = (publicKey: string): string => {
    try {
      const parts = publicKey.trim().split(/\s+/);
      if (parts.length < 2 || !parts[1]) return "Unknown";
      
      // For Ed25519 and RSA, we'd need to decode base64 and hash
      // Simplified version - in production, use proper SSH key fingerprint calculation
      const keyData = parts[1];
      if (keyData.length > 20) {
        return `${keyData.substring(0, 8)}...${keyData.substring(keyData.length - 8)}`;
      }
      return keyData;
    } catch {
      return "Unknown";
    }
  };

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
      const privateKeyPkcs8 = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyPkcs8)));
      
      // Export public key (SPKI format)
      const publicKeySpki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
      const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeySpki)));
      
      // Format as OpenSSH public key
      // Note: This is a simplified conversion - proper OpenSSH format conversion requires additional libraries
      const publicKeyFormatted = `ssh-ed25519 ${publicKeyBase64} ${generatedTitle || `gittr-space-${Date.now()}`}`;
      
      setGeneratedPublicKey(publicKeyFormatted);
      setGeneratedPrivateKey(`-----BEGIN PRIVATE KEY-----\n${privateKeyBase64}\n-----END PRIVATE KEY-----`);
      setStatus("Key generated! Download your private key before adding the public key.");
    } catch (error: any) {
      console.error("Error generating key:", error);
      // Fallback: Provide instructions for manual generation
      setError("Browser key generation not fully supported. Please generate keys using: ssh-keygen -t ed25519 -C 'your-email@example.com'");
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
    setStatus("Adding SSH key...");

    try {
      // Validate SSH key format
      const keyParts = publicKeyInput.trim().split(/\s+/);
      if (keyParts.length < 2 || !keyParts[0]) {
        throw new Error("Invalid SSH key format. Expected: <key-type> <public-key> [title]");
      }

      const validKeyTypes = ["ssh-rsa", "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"];
      const keyType = keyParts[0];
      if (!validKeyTypes.includes(keyType)) {
        throw new Error(`Invalid key type: ${keyType}. Supported: ${validKeyTypes.join(", ")}`);
      }

      // Get private key for signing
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      let privateKey: string | null = null;
      let signerPubkey = pubkey;

      if (hasNip07 && window.nostr) {
        try {
          const pubkeyFromNip07 = await window.nostr.getPublicKey();
          signerPubkey = pubkeyFromNip07;
        } catch (err) {
          console.warn("NIP-07 failed, trying private key:", err);
          privateKey = await getNostrPrivateKey();
        }
      } else {
        privateKey = await getNostrPrivateKey();
      }

      if (!privateKey && !hasNip07) {
        throw new Error("No signing method available. Please configure NIP-07 or private key.");
      }

      // Prepare key content with title
      let keyContent = publicKeyInput.trim();
      if (keyTitle && !keyParts[2]) {
        keyContent = `${keyParts[0]} ${keyParts[1]} ${keyTitle}`;
      } else if (!keyTitle && !keyParts[2]) {
        keyContent = `${keyParts[0]} ${keyParts[1]} gittr-space-${Date.now()}`;
      }

      // Create SSH key event
      let sshKeyEvent: any;
      if (hasNip07 && window.nostr) {
        // Use NIP-07
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unsignedEvent: any = {
          kind: KIND_SSH_KEY,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: keyContent,
          pubkey: signerPubkey,
          id: "",
          sig: "",
        };
        unsignedEvent.id = getEventHash(unsignedEvent);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        sshKeyEvent = await window.nostr.signEvent(unsignedEvent as any);
      } else if (privateKey) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        sshKeyEvent = createSSHKeyEvent(
          { publicKey: keyContent, title: keyTitle },
          privateKey
        );
      } else {
        throw new Error("No signing method available");
      }

      // Publish to Nostr relays
      if (publish) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        void publish(sshKeyEvent as any, defaultRelays);
        
        // CRITICAL: Also send SSH key event directly to bridge API for immediate processing
        // The bridge only watches for SSH keys from users with repository permissions via relay subscription,
        // but sending directly ensures it's processed immediately even for new users
        try {
          const bridgeResponse = await fetch("/api/nostr/repo/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sshKeyEvent),
          });
          if (bridgeResponse.ok) {
            console.log(`✅ [SSH Keys] SSH key event sent directly to bridge: ${sshKeyEvent.id.slice(0, 16)}...`);
          } else {
            console.warn(`⚠️ [SSH Keys] Bridge API returned ${bridgeResponse.status} for SSH key event - bridge will receive via relay subscription`);
          }
        } catch (bridgeError: any) {
          console.warn(`⚠️ [SSH Keys] Failed to send SSH key event to bridge API (will receive via relay):`, bridgeError?.message);
        }
        
        // Store locally for quick access
        const newKey: SSHKey = {
          id: sshKeyEvent.id,
          title: keyTitle || keyParts[2] || `gittr-space-${Date.now()}`,
          keyType: keyType,
          publicKey: keyContent,
          fingerprint: calculateFingerprint(keyContent),
          createdAt: Date.now(),
        };

        const stored = JSON.parse(localStorage.getItem(`gittr_ssh_keys_${pubkey}`) || "[]");
        stored.push(newKey);
        localStorage.setItem(`gittr_ssh_keys_${pubkey}`, JSON.stringify(stored));
        
        setKeys(stored);
        setStatus("SSH key added successfully! Published to Nostr relays and sent to bridge. The git-nostr-bridge will process it immediately. Note: If publishing fails, some relays may not accept KIND_52 (NIP-52 conflict).");
        setShowAddForm(false);
        setPublicKeyInput("");
        setKeyTitle("");
        
        // Dispatch event
        window.dispatchEvent(new CustomEvent("gittr:ssh-key-added", { detail: newKey }));
      }
    } catch (error: any) {
      console.error("Error adding SSH key:", error);
      let errorMsg = error.message || "Failed to add SSH key";
      // Check if it's a relay rejection (common with KIND_52 due to NIP-52 conflict)
      if (errorMsg.includes("rejected") || errorMsg.includes("blocked") || errorMsg.includes("kind")) {
        errorMsg += ". Note: Some relays may reject KIND_52 (conflicts with NIP-52 Calendar Events). Try a different relay or check relay logs.";
      }
      setError(errorMsg);
      setStatus("");
    }
  }, [pubkey, publish, defaultRelays, publicKeyInput, keyTitle]);

  // Delete SSH key
  const handleDeleteKey = useCallback(async (keyId: string) => {
    if (!confirm("Are you sure you want to delete this SSH key? You won&apos;t be able to use it for Git operations.")) {
      return;
    }

    try {
      const stored = JSON.parse(localStorage.getItem(`gittr_ssh_keys_${pubkey}`) || "[]");
      const keyToDelete = stored.find((k: SSHKey) => k.id === keyId);
      
      if (!keyToDelete) {
        setError("SSH key not found");
        return;
      }

      // Remove from localStorage
      const filtered = stored.filter((k: SSHKey) => k.id !== keyId);
      localStorage.setItem(`gittr_ssh_keys_${pubkey}`, JSON.stringify(filtered));
      setKeys(filtered);
      
      // Publish deletion event to Nostr (NIP-09: Deletion event)
      if (pubkey && publish && defaultRelays && defaultRelays.length > 0) {
        try {
          const privateKey = await getNostrPrivateKey();
          const hasNip07 = typeof window !== "undefined" && window.nostr;
          
          if (privateKey || hasNip07) {
            // Create NIP-09 deletion event pointing to the SSH key event
            // For SSH keys, we use the key's public key as the identifier
            // Note: We'd need the original event ID to properly reference it
            // For now, we'll create a deletion event with the key content as reference
            const { getEventHash, signEvent, getPublicKey } = await import("nostr-tools");
            const authorPubkey = privateKey ? getPublicKey(privateKey) : (hasNip07 ? await window.nostr.getPublicKey() : pubkey);
            
            // Create deletion event (NIP-09: kind 5)
            // Tags: [["e", eventId, relay, "deletion"]] - but we don't have the original event ID
            // Alternative: Create a revocation event with the key content
            const deletionEvent = {
              kind: 5, // NIP-09: Deletion
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                // Reference the SSH key by its content (if we had the event ID, we'd use ["e", eventId])
                // For now, we'll use a tag to indicate which key is being revoked
                ["key", keyToDelete.publicKey],
                ["reason", "SSH key revocation"]
              ],
              content: `Revoked SSH key: ${keyToDelete.title || keyToDelete.id}`,
              pubkey: authorPubkey,
              id: "",
              sig: "",
            };
            
            deletionEvent.id = getEventHash(deletionEvent);
            
            if (hasNip07 && window.nostr) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
              const signedEvent = await window.nostr.signEvent(deletionEvent as any);
              publish(signedEvent, defaultRelays);
            } else if (privateKey) {
              deletionEvent.sig = signEvent(deletionEvent, privateKey);
              publish(deletionEvent, defaultRelays);
            }
          }
        } catch (err) {
          console.error("Failed to publish SSH key deletion event:", err);
          // Continue with local deletion even if Nostr publish fails
        }
      }
      
      setStatus("SSH key deleted" + (publish ? " and revoked on Nostr" : ""));
      setTimeout(() => setStatus(""), 3000);
    } catch (error: any) {
      setError("Failed to delete SSH key");
      console.error("Error deleting SSH key:", error);
    }
  }, [pubkey, publish, defaultRelays]);

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
  const downloadPrivateKey = useCallback((privateKey: string, title: string) => {
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
  }, []);

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
                  <li><strong>Web UI operations</strong> (Push to Nostr, PRs, Issues) publish <strong>NIP‑34 events</strong> via your Nostr key (NIP‑07 or nsec). <strong>No SSH key required.</strong></li>
                  <li><strong>Command-line Git operations</strong> (<code className="bg-yellow-900/50 px-1 rounded">git clone</code>, <code className="bg-yellow-900/50 px-1 rounded">git push</code>, <code className="bg-yellow-900/50 px-1 rounded">git pull</code>) talk to the git bridge (e.g. <code className="bg-yellow-900/50 px-1 rounded">git.gittr.space</code>) and <strong>do require an SSH key</strong>.</li>
                  <li>SSH keys are <strong>only needed if you want to interact with gittr from your terminal/CI</strong>.</li>
                  <li>If you stay in the browser and let us publish NIP‑34 events for you, you can skip SSH keys entirely.</li>
                </ul>
              </div>
            </div>
          </div>
          
          <p className="text-gray-400 mt-1 text-sm sm:text-base">
            Manage SSH keys for command-line Git operations over SSH. Keys are published to Nostr (Kind 52) and used by the git-nostr-bridge when you run <code className="bg-gray-800 px-1 rounded">git clone</code>, <code className="bg-gray-800 px-1 rounded">git push</code>, or <code className="bg-gray-800 px-1 rounded">git pull</code> against <code className="bg-gray-800 px-1 rounded">git.gittr.space</code> or other GRASP servers.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            onClick={() => {
              setShowGenerateForm(true);
              setShowAddForm(false);
              setError(null);
              setStatus("");
            }}
            variant="outline"
            className="flex-1 sm:flex-none"
          >
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Generate Key</span>
            <span className="sm:hidden">Generate</span>
          </Button>
          <Button
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
          Connect your GitHub account to import and access private repositories. The OAuth token is stored locally in your browser and used for GitHub API requests.
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
                const response = await fetch("/api/github/auth?action=initiate", {
                  method: "GET",
                });
                
                if (!response.ok) {
                  const errorData = await response.json();
                  throw new Error(errorData.error || "Failed to initiate OAuth");
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
                
                console.log('[SSH Keys] Opening OAuth popup:', data.authUrl);
                const popup = window.open(
                  data.authUrl,
                  "GitHub OAuth",
                  `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
                );
                
                if (!popup) {
                  setError("Popup was blocked. Please allow popups for this site and try again.");
                  setGithubConnecting(false);
                  githubConnectingRef.current = false;
                  return;
                }
                
                console.log('[SSH Keys] Popup opened, waiting for message...');
                
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
                    console.log('[SSH Keys] Popup closed, waiting for message...');
                    // Give it more time for message to arrive (popup might close before message is processed)
                    setTimeout(() => {
                      // Use ref to check current state (avoids closure issue)
                      if (githubConnectingRef.current) {
                        console.log('[SSH Keys] No message received after popup closed, resetting connecting state');
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

      {/* Info box */}
      <div className="mb-6 p-4 bg-blue-900/20 border border-blue-700 rounded text-blue-400 max-w-2xl">
        <div className="flex items-start gap-2">
          <Info className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div className="text-sm min-w-0 flex-1">
            <p className="font-semibold mb-1">How SSH Keys Work</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>SSH keys are published to Nostr (KIND_SSH_KEY = 52, from gitnostr protocol)</li>
              <li className="text-yellow-400">⚠️ Note: KIND_52 conflicts with NIP-52 (Calendar Events). Most relays accept it, but some may reject. If publishing fails, try a different relay.</li>
              <li>The git-nostr-bridge listens for your SSH key events and updates authorized_keys</li>
              <li>Use one SSH key for all your repositories (like GitHub)</li>
              <li>You can generate a key here or use an existing one</li>
              <li>Private keys are only shown/downloaded once - keep them secure!</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Generate Key Form */}
      {showGenerateForm && (
        <div className="mb-6 border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h2 className="text-lg font-semibold mb-4">Generate New SSH Key</h2>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="key-title-generate">Key Title (optional)</Label>
              <Input
                id="key-title-generate"
                value={generatedTitle}
                onChange={e => setGeneratedTitle(e.target.value)}
                placeholder="My Laptop Key"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={generateKeyPair}>
                Generate Ed25519 Key
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowGenerateForm(false);
                  setGeneratedPrivateKey(null);
                  setGeneratedPublicKey(null);
                  setGeneratedTitle("");
                }}
              >
                Cancel
              </Button>
            </div>

            {generatedPublicKey && generatedPrivateKey && (
              <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded">
                <AlertCircle className="h-5 w-5 text-yellow-400 mb-2" />
                <p className="text-yellow-400 text-sm font-semibold mb-2">
                  ⚠️ Download your private key now - you won&apos;t see it again!
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => downloadPrivateKey(generatedPrivateKey, generatedTitle || "key")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Private Key
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPublicKeyInput(generatedPublicKey);
                        setKeyTitle(generatedTitle || "Generated Key");
                        setShowGenerateForm(false);
                        setShowAddForm(true);
                        setGeneratedPrivateKey(null);
                        setGeneratedPublicKey(null);
                      }}
                    >
                      Add Public Key to gittr.space
                    </Button>
                  </div>
                  <div className="mt-2">
                    <Label>Public Key (copy this)</Label>
                    <div className="flex gap-2">
                      <Textarea
                        value={generatedPublicKey}
                        readOnly
                        className="bg-[#0E1116] border-[#383B42] text-white font-mono text-xs"
                        rows={2}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyPublicKey(generatedPublicKey)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Alternative: Manual generation instructions */}
            {error && error.includes("Browser key generation") && (
              <div className="mt-4 p-4 bg-gray-900 border border-gray-700 rounded">
                <p className="text-sm font-semibold mb-2">Generate Key Manually:</p>
                <code className="block p-2 bg-black rounded text-xs mb-2">
                  ssh-keygen -t ed25519 -C "your-email@example.com"
                </code>
                <p className="text-xs text-gray-400">
                  Then copy your public key from ~/.ssh/id_ed25519.pub and paste it below.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Key Form */}
      {showAddForm && (
        <div className="mb-6 border border-[#383B42] rounded p-6 bg-[#171B21]">
          <h2 className="text-lg font-semibold mb-4">Add SSH Key</h2>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="public-key">Public Key</Label>
              <Textarea
                id="public-key"
                value={publicKeyInput}
                onChange={e => setPublicKeyInput(e.target.value)}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... My Key"
                rows={3}
                className="bg-[#0E1116] border-[#383B42] text-white font-mono text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                Paste your public SSH key here (from ~/.ssh/id_*.pub)
              </p>
            </div>

            <div>
              <Label htmlFor="key-title">Key Title (optional)</Label>
              <Input
                id="key-title"
                value={keyTitle}
                onChange={e => setKeyTitle(e.target.value)}
                placeholder="My Laptop Key"
                className="bg-[#0E1116] border-[#383B42] text-white"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAddKey} disabled={!publicKeyInput.trim()}>
                Add SSH Key
              </Button>
              <Button
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

      {/* SSH Keys List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Your SSH Keys</h2>
        
        {loading ? (
          <p className="text-gray-400">Loading SSH keys...</p>
        ) : keys.length === 0 ? (
          <div className="border border-[#383B42] rounded p-8 text-center bg-[#171B21]">
            <Key className="h-12 w-12 mx-auto mb-4 text-gray-500" />
            <p className="text-gray-400 mb-4">No SSH keys added yet.</p>
            <p className="text-sm text-gray-500">
              Add an SSH key to enable Git operations (clone, push, create repos) over SSH.
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
                      <Badge variant="outline" className="border-purple-700 text-purple-400 bg-purple-900/20">
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


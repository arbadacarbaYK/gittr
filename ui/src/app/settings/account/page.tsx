"use client";
import { useEffect, useState } from "react";
import SettingsHero from "@/components/settings-hero";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useMetadata from "@/lib/nostr/useMetadata";
import { CheckCircle2, XCircle, AlertCircle, Lock, Shield } from "lucide-react";
import { normalizeUrlOnBlur } from "@/lib/utils/url-normalize";
import { getNostrPrivateKey, getSecureItem, setSecureItem, isEncryptionUnlocked, isEncryptionEnabled } from "@/lib/security/encryptedStorage";
import { getEventHash, signEvent } from "nostr-tools";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function AccountSettingsPage() {
  const { pubkey, publish, defaultRelays } = useNostrContext();
  const metadata = useMetadata();
  const [lnurl, setLnurl] = useState("");
  const [lud16, setLud16] = useState("");
  const [nwcRecv, setNwcRecv] = useState("");
  const [nwcSend, setNwcSend] = useState("");
  const [githubProfile, setGithubProfile] = useState("");
  const [lnbitsUrl, setLnbitsUrl] = useState("");
  const [lnbitsAdminKey, setLnbitsAdminKey] = useState("");
  const [lnbitsInvoiceKey, setLnbitsInvoiceKey] = useState("");
  const [saved, setSaved] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<Record<string, boolean>>({});
  const [showValidation, setShowValidation] = useState(false); // Only show errors after save attempt
  const [lnbitsBalance, setLnbitsBalance] = useState<{ loading?: boolean; balance?: number; error?: string } | null>(null);
  const [nwcBalance, setNwcBalance] = useState<{ loading?: boolean; connected?: boolean; balance?: number; error?: string } | null>(null);
  const [nwcRecvBalance, setNwcRecvBalance] = useState<{ loading?: boolean; connected?: boolean; balance?: number; error?: string } | null>(null);
  const [githubAuthenticating, setGithubAuthenticating] = useState(false);
  
  // Check if user has NIP-05 verification
  const hasNip05 = !!metadata.nip05;
  const encryptionEnabled = typeof window !== "undefined" ? isEncryptionEnabled() : false;
  const encryptionUnlocked = typeof window !== "undefined" ? isEncryptionUnlocked() : false;

  useEffect(() => {
    // Load wallet data using secure storage (encrypted if encryption is enabled)
    const loadWalletData = async () => {
      try {
        const lnurl = await getSecureItem("gittr_lnurl");
        const lud16 = await getSecureItem("gittr_lud16");
        const nwcRecv = await getSecureItem("gittr_nwc_recv");
        const nwcSend = await getSecureItem("gittr_nwc_send");
        const lnbitsUrl = await getSecureItem("gittr_lnbits_url");
        const lnbitsAdminKey = await getSecureItem("gittr_lnbits_admin_key");
        const lnbitsInvoiceKey = await getSecureItem("gittr_lnbits_invoice_key");
        
        // GitHub profile is not sensitive, can stay in plaintext localStorage
        const githubProfile = localStorage.getItem("gittr_github_profile") || "";
        
        setLnurl(lnurl || "");
        setLud16(lud16 || "");
        setNwcRecv(nwcRecv || "");
        setNwcSend(nwcSend || "");
        setGithubProfile(githubProfile);
        setLnbitsUrl(lnbitsUrl || "");
        setLnbitsAdminKey(lnbitsAdminKey || "");
        setLnbitsInvoiceKey(lnbitsInvoiceKey || "");
        
        // Debug: Verify NWC string was loaded correctly (don't log full string for security)
        if (nwcSend) {
          console.log("NWC Load: NWC string loaded successfully");
          console.log("NWC Load: Length:", nwcSend.length);
          console.log("NWC Load: Starts with nostr+walletconnect:", nwcSend.startsWith("nostr+walletconnect:"));
        }
      } catch (error) {
        console.error("Failed to load wallet data:", error);
        // Fallback to plaintext for migration (if encryption fails)
        setLnurl(localStorage.getItem("gittr_lnurl") || "");
        setLud16(localStorage.getItem("gittr_lud16") || "");
        setNwcRecv(localStorage.getItem("gittr_nwc_recv") || "");
        setNwcSend(localStorage.getItem("gittr_nwc_send") || "");
        setGithubProfile(localStorage.getItem("gittr_github_profile") || "");
        setLnbitsUrl(localStorage.getItem("gittr_lnbits_url") || "");
        setLnbitsAdminKey(localStorage.getItem("gittr_lnbits_admin_key") || "");
        setLnbitsInvoiceKey(localStorage.getItem("gittr_lnbits_invoice_key") || "");
      }
    };
    
    loadWalletData();
    // Don't validate on initial load
  }, []);

  function validateLNURL(value: string): string | null {
    if (!value) return null;
    if (!value.toLowerCase().startsWith("lnurl")) {
      return "LNURL must start with 'lnurl'";
    }
    if (value.length < 10) {
      return "Invalid LNURL format";
    }
    return null;
  }

  function validateLUD16(value: string): string | null {
    if (!value) return null;
    // Only validate if user has typed something that looks complete
    // Don't block partial input like "name@" 
    if (!value.includes("@")) {
      return null; // Allow typing before @
    }
    const parts = value.split("@");
    if (parts.length !== 2) {
      return "Lightning address must be in format: name@domain";
    }
    if (!parts[0] || !parts[1]) {
      return "Both username and domain are required";
    }
    if (!parts[1].includes(".")) {
      return "Domain must be valid (e.g., example.com)";
    }
    return null;
  }

  function validateNWC(value: string): string | null {
    if (!value) return null;
    if (!value.startsWith("nostr+walletconnect://")) {
      return "NWC URI must start with 'nostr+walletconnect://'";
    }
    try {
      const url = new URL(value);
      const relay = url.searchParams.get("relay");
      const secret = url.searchParams.get("secret");
      if (!relay || !secret) {
        return "NWC URI must include 'relay' and 'secret' parameters";
      }
      if (!relay.startsWith("wss://")) {
        return "Relay URL must start with 'wss://'";
      }
    } catch {
      return "Invalid NWC URI format";
    }
    return null;
  }

  function validateGitHubURL(value: string): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (!url.hostname.includes("github.com")) {
        return "Must be a GitHub.com URL";
      }
      const pathParts = url.pathname.split("/").filter(p => p);
      if (pathParts.length === 0) {
        return "GitHub URL must include username";
      }
    } catch {
      return "Invalid URL format";
    }
    return null;
  }

  function normalizeGitHubURL(value: string): string {
    if (!value) return value;
    try {
      // Remove protocol if present
      let url = value.replace(/^https?:\/\//, '');
      // Remove www if present
      url = url.replace(/^www\./, '');
      // Remove trailing slash
      url = url.replace(/\/$/, '');
      // Ensure github.com
      if (!url.startsWith("github.com/")) {
        url = "github.com/" + url.replace(/^github\.com\//, '');
      }
      return "https://" + url;
    } catch {
      return value;
    }
  }

  function validateAll(): Record<string, string> {
    const newErrors: Record<string, string> = {};
    const newValidation: Record<string, boolean> = {};

    const lnurlError = validateLNURL(lnurl);
    if (lnurlError) newErrors.lnurl = lnurlError;
    newValidation.lnurl = !lnurlError && lnurl.length > 0;

    const lud16Error = validateLUD16(lud16);
    if (lud16Error) newErrors.lud16 = lud16Error;
    newValidation.lud16 = !lud16Error && lud16.length > 0;

    const nwcRecvError = validateNWC(nwcRecv);
    if (nwcRecvError) newErrors.nwcRecv = nwcRecvError;
    newValidation.nwcRecv = !nwcRecvError && nwcRecv.length > 0;

    const nwcSendError = validateNWC(nwcSend);
    if (nwcSendError) newErrors.nwcSend = nwcSendError;
    newValidation.nwcSend = !nwcSendError && nwcSend.length > 0;

    const githubError = validateGitHubURL(githubProfile);
    if (githubError) newErrors.github = githubError;
    newValidation.github = !githubError && githubProfile.length > 0;

    // LNbits URL validation - only if field has value
    if (lnbitsUrl && !lnbitsUrl.match(/^https?:\/\/.+/)) {
      newErrors.lnbitsUrl = "LNbits URL must be a valid HTTP/HTTPS URL";
    }
    newValidation.lnbitsUrl = !newErrors.lnbitsUrl && lnbitsUrl.length > 0;

    // LNbits admin key validation (should be hex string, 32+ chars) - only if field has value
    if (lnbitsAdminKey && !lnbitsAdminKey.match(/^[a-f0-9]{32,}$/i)) {
      newErrors.lnbitsAdminKey = "LNbits admin key must be a valid hex string (32+ characters)";
    }
    newValidation.lnbitsAdminKey = !newErrors.lnbitsAdminKey && lnbitsAdminKey.length > 0;

    // LNbits invoice key validation (should be hex string, 32+ chars) - only if field has value
    if (lnbitsInvoiceKey && !lnbitsInvoiceKey.match(/^[a-f0-9]{32,}$/i)) {
      newErrors.lnbitsInvoiceKey = "LNbits invoice key must be a valid hex string (32+ characters)";
    }
    newValidation.lnbitsInvoiceKey = !newErrors.lnbitsInvoiceKey && lnbitsInvoiceKey.length > 0;

    // Only update state if validation should be shown (after save attempt)
    // This prevents re-renders during typing
    if (showValidation) {
      setErrors(newErrors);
      setValidation(newValidation);
    }
    return newErrors;
  }

  async function saveAll() {
    // Validate before saving
    setShowValidation(true); // Show validation errors after save attempt
    const validationErrors = validateAll();
    
    // Check for errors
    if (Object.keys(validationErrors).length > 0) {
      setSaved("Please fix errors before saving");
      setTimeout(() => setSaved(""), 3000);
      return;
    }

    // Normalize GitHub URL before saving
    const normalizedGithub = normalizeGitHubURL(githubProfile);
    
    try {
      // Save wallet data using secure storage (encrypted if encryption is enabled)
      await setSecureItem("gittr_lnurl", lnurl);
      await setSecureItem("gittr_lud16", lud16);
      await setSecureItem("gittr_nwc_recv", nwcRecv);
      await setSecureItem("gittr_nwc_send", nwcSend);
      await setSecureItem("gittr_lnbits_url", lnbitsUrl);
      await setSecureItem("gittr_lnbits_admin_key", lnbitsAdminKey);
      await setSecureItem("gittr_lnbits_invoice_key", lnbitsInvoiceKey);
      
      // GitHub profile is not sensitive, can stay in plaintext localStorage
      localStorage.setItem("gittr_github_profile", normalizedGithub);
      
      // Also store in pubkey-to-github mapping
      if (pubkey && normalizedGithub) {
        try {
          const mappings = JSON.parse(localStorage.getItem("gittr_github_mappings") || "{}");
          mappings[pubkey] = normalizedGithub;
          localStorage.setItem("gittr_github_mappings", JSON.stringify(mappings));
        } catch {}
      }
      
      setSaved("Saved successfully!");
      setTimeout(() => setSaved(""), 2000);
      
      // Test payment options after saving
      if (lnbitsUrl && lnbitsAdminKey) {
        testLnbitsBalance();
      }
      if (nwcSend) {
        testNwcConnection();
      }
      if (nwcRecv) {
        testNwcRecvConnection();
      }
    } catch (error: any) {
      console.error("Failed to save wallet data:", error);
      if (error.message?.includes("Encryption password required")) {
        setSaved("Encryption is enabled. Please unlock encryption to view/edit settings.");
        setTimeout(() => setSaved(""), 5000);
      } else {
        setSaved(`Failed to save: ${error.message || "Unknown error"}`);
        setTimeout(() => setSaved(""), 3000);
      }
    }
  }

  async function connectGitHub() {
    setGithubAuthenticating(true);
    try {
      // Get OAuth URL from backend
      const response = await fetch("/api/github/auth?action=initiate");
      const data = await response.json();
      
      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to get GitHub OAuth URL. Please check GITHUB_OAUTH_SETUP.md for configuration instructions.");
      }
      
      if (!data.authUrl) {
        throw new Error("Failed to get GitHub OAuth URL");
      }
      
      // Open popup window
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        data.authUrl,
        "GitHub Authentication",
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
      );
      
      if (!popup) {
        setSaved("Popup blocked. Please allow popups for this site.");
        setTimeout(() => setSaved(""), 3000);
        setGithubAuthenticating(false);
        return;
      }
      
      // Listen for OAuth callback message from popup
      const messageHandler = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        
        if (event.data.type === 'GITHUB_OAUTH_CALLBACK') {
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
          setGithubAuthenticating(false);
          
          if (event.data.error) {
            setSaved(`GitHub connection error: ${event.data.error}`);
            setTimeout(() => setSaved(""), 3000);
            return;
          }
          
          if (!event.data.code) {
            setSaved("GitHub connection cancelled");
            setTimeout(() => setSaved(""), 3000);
            return;
          }
          
          try {
            // Exchange code for GitHub user data
            const response = await fetch(`/api/github/auth?action=callback&code=${event.data.code}&state=${event.data.state}`);
            const data = await response.json();
            
            if (!response.ok || data.error) {
              throw new Error(data.error || "Failed to complete GitHub authentication");
            }
            
            if (data.githubUrl && data.githubUsername) {
              // Save GitHub profile URL
              const normalizedGithub = normalizeGitHubURL(data.githubUrl);
              setGithubProfile(normalizedGithub);
              localStorage.setItem("gittr_github_profile", normalizedGithub);
              
              // Store mapping: pubkey -> GitHub URL
              if (pubkey) {
                const mappings = JSON.parse(localStorage.getItem("gittr_github_mappings") || "{}");
                mappings[pubkey] = normalizedGithub;
                localStorage.setItem("gittr_github_mappings", JSON.stringify(mappings));
                
                // Update repo contributors
                updateAllReposContributors(pubkey, data.githubUsername);
              }
              
              // Automatically publish NIP-39 identity claim to Nostr
              try {
                const privateKey = await getNostrPrivateKey();
                if (privateKey && publish && defaultRelays && pubkey) {
                  // Get current metadata to preserve existing fields
                  const currentMetadata = JSON.parse(localStorage.getItem(`gittr_metadata_${pubkey}`) || "{}");
                  
                  // Build NIP-39 i tag for GitHub identity
                  const iTags: string[][] = [["i", `github:${data.githubUsername}`]];
                  
                  // If there are existing identities in metadata, preserve them
                  // (This is a best-effort - ideally we'd fetch from Nostr, but for now we use localStorage cache)
                  if (currentMetadata.identities && Array.isArray(currentMetadata.identities)) {
                    currentMetadata.identities.forEach((identity: any) => {
                      if (identity.platform && identity.identity && 
                          !(identity.platform === "github" && identity.identity === data.githubUsername)) {
                        const identityString = `${identity.platform}:${identity.identity}`;
                        if (identity.proof) {
                          iTags.push(["i", identityString, identity.proof]);
                        } else {
                          iTags.push(["i", identityString]);
                        }
                      }
                    });
                  }
                  
                  // Create Kind 0 metadata event with NIP-39 identity claim
                  const metadata = {
                    display_name: currentMetadata.display_name || undefined,
                    name: currentMetadata.name || undefined,
                    about: currentMetadata.about || undefined,
                    nip05: currentMetadata.nip05 || undefined,
                    picture: currentMetadata.picture || undefined,
                  };
                  
                  // Remove undefined fields
                  Object.keys(metadata).forEach(key => {
                    if ((metadata as any)[key] === undefined) {
                      delete (metadata as any)[key];
                    }
                  });
                  
                  const event: any = {
                    kind: 0,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: iTags, // Include NIP-39 identity tags
                    content: JSON.stringify(metadata),
                    pubkey: pubkey,
                    id: "",
                    sig: "",
                  };
                  
                  event.id = getEventHash(event);
                  
                  // Sign with NIP-07 or private key
                  const hasNip07 = typeof window !== "undefined" && window.nostr;
                  let signedEvent = event;
                  if (hasNip07 && window.nostr) {
                    // Use NIP-07 extension (supports remote signer)
                    signedEvent = await window.nostr.signEvent(event);
                  } else if (privateKey) {
                    // Use private key (fallback)
                    signedEvent = { ...event };
                    signedEvent.sig = signEvent(signedEvent, privateKey);
                  } else {
                    throw new Error("No signing method available");
                  }
                  
                  // Publish to relays
                  publish(signedEvent, defaultRelays);
                  
                  setSaved(`✅ GitHub connected and published to Nostr! Username: ${data.githubUsername}`);
                  setTimeout(() => setSaved(""), 5000);
                } else {
                  setSaved(`✅ GitHub connected! Username: ${data.githubUsername}. You can now add this as a verified identity on your Profile page.`);
                  setTimeout(() => setSaved(""), 5000);
                }
              } catch (publishError: any) {
                console.error("Failed to publish GitHub identity to Nostr:", publishError);
                setSaved(`✅ GitHub connected! Username: ${data.githubUsername}. Note: Failed to publish to Nostr (${publishError.message}). You can add this manually on your Profile page.`);
                setTimeout(() => setSaved(""), 5000);
              }
              
              // Dispatch event to notify profile page
              window.dispatchEvent(new CustomEvent('gittr:github-connected', {
                detail: { username: data.githubUsername, url: normalizedGithub }
              }));
            } else {
              throw new Error("GitHub authentication succeeded but no user data received");
            }
          } catch (error: any) {
            setSaved(`GitHub connection error: ${error.message}`);
            setTimeout(() => setSaved(""), 3000);
          }
        }
      };
      
      window.addEventListener('message', messageHandler);
      
      // Check if popup is closed (user cancelled)
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
          setGithubAuthenticating(false);
        }
      }, 500);
      
    } catch (error: any) {
      setSaved(`GitHub connection error: ${error.message}`);
      setTimeout(() => setSaved(""), 3000);
      setGithubAuthenticating(false);
    }
  }

  function updateAllReposContributors(pubkey: string, githubUsername: string) {
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      
      repos.forEach((repo: any) => {
        if (repo.contributors && Array.isArray(repo.contributors)) {
          // Update contributors that match this GitHub username
          repo.contributors = repo.contributors.map((contrib: any) => {
            if (contrib.githubLogin && contrib.githubLogin.toLowerCase() === githubUsername.toLowerCase()) {
              // This contributor matches - add their pubkey
              return { ...contrib, pubkey };
            }
            return contrib;
          });
        }
      });
      
      localStorage.setItem("gittr_repos", JSON.stringify(repos));
    } catch (error) {
      console.error("Failed to update repo contributors:", error);
    }
  }
  
  async function testLnbitsBalance() {
    if (!lnbitsUrl || !lnbitsAdminKey) return;
    
    setLnbitsBalance({ loading: true });
    
    try {
      const response = await fetch("/api/balance/lnbits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lnbitsUrl, lnbitsAdminKey }),
      });
      
      const data = await response.json();
      
      if (data.status === "ok") {
        setLnbitsBalance({ 
          balance: data.balanceSats,
          loading: false 
        });
      } else {
        setLnbitsBalance({ 
          error: data.message || "Failed to fetch balance",
          loading: false 
        });
      }
    } catch (error: any) {
      setLnbitsBalance({ 
        error: error.message || "Failed to connect to LNbits",
        loading: false 
      });
    }
  }
  
  async function testNwcConnection() {
    if (!nwcSend) return;
    
    setNwcBalance({ loading: true });
    
    // Debug: Verify NWC string format (don't log full string for security)
    console.log("NWC Test (Send): Testing connection - NWC string length:", nwcSend.length);
    console.log("NWC Test (Send): Starts with nostr+walletconnect:", nwcSend.startsWith("nostr+walletconnect:"));
    
    try {
      // Use simpler connection test instead of balance check
      const { testNWCConnection } = await import("@/lib/payments/nwc-connection-test");
      const result = await testNWCConnection(nwcSend);
      
      if (result.connected && result.relayReachable) {
        if (result.requestAccepted) {
          // Full success - connection works and wallet responded
          setNwcBalance({ 
            connected: true,
            loading: false,
            // Try to get balance if connection works
            balance: undefined // Will be set if get_balance works
          });
          
          // Optionally try to get balance now that we know connection works
          try {
            const { getNWCBalance } = await import("@/lib/payments/nwc-balance");
            const balanceResult = await getNWCBalance(nwcSend);
            setNwcBalance(prev => prev ? { ...prev, balance: balanceResult.balanceSats } : prev);
          } catch (balanceError) {
            // Balance check failed but connection works - that's OK
            console.log("NWC (Send): Connection works but balance check not supported");
          }
        } else {
          // Connection works but method not supported
          setNwcBalance({ 
            connected: true,
            loading: false,
            error: result.error || "Connection verified. Wallet may not support balance queries, but payments will work."
          });
        }
      } else {
        // Connection failed
        setNwcBalance({ 
          connected: false,
          loading: false,
          error: result.error || "Failed to connect to relay. Check your NWC URI and relay URL."
        });
      }
    } catch (error: any) {
      console.error("NWC (Send) connection test error:", error);
      setNwcBalance({ 
        connected: false,
        error: error.message || "Failed to test NWC connection. Check your NWC URI format.",
        loading: false 
      });
    }
  }
  
  async function testNwcRecvConnection() {
    if (!nwcRecv) return;
    
    setNwcRecvBalance({ loading: true });
    
    // Debug: Verify NWC string format (don't log full string for security)
    console.log("NWC Test (Receive): Testing connection - NWC string length:", nwcRecv.length);
    console.log("NWC Test (Receive): Starts with nostr+walletconnect:", nwcRecv.startsWith("nostr+walletconnect:"));
    
    try {
      // Use simpler connection test instead of balance check
      const { testNWCConnection } = await import("@/lib/payments/nwc-connection-test");
      const result = await testNWCConnection(nwcRecv);
      
      if (result.connected && result.relayReachable) {
        if (result.requestAccepted) {
          // Full success - connection works and wallet responded
          setNwcRecvBalance({ 
            connected: true,
            loading: false,
            // Try to get balance if connection works
            balance: undefined // Will be set if get_balance works
          });
          
          // Optionally try to get balance now that we know connection works
          try {
            const { getNWCBalance } = await import("@/lib/payments/nwc-balance");
            const balanceResult = await getNWCBalance(nwcRecv);
            setNwcRecvBalance(prev => prev ? { ...prev, balance: balanceResult.balanceSats } : prev);
          } catch (balanceError) {
            // Balance check failed but connection works - that's OK
            console.log("NWC (Receive): Connection works but balance check not supported");
          }
        } else {
          // Connection works but method not supported
          setNwcRecvBalance({ 
            connected: true,
            loading: false,
            error: result.error || "Connection verified. Wallet may not support balance queries, but payments will work."
          });
        }
      } else {
        // Connection failed
        setNwcRecvBalance({ 
          connected: false,
          loading: false,
          error: result.error || "Failed to connect to relay. Check your NWC URI and relay URL."
        });
      }
    } catch (error: any) {
      console.error("NWC (Receive) connection test error:", error);
      setNwcRecvBalance({ 
        connected: false,
        error: error.message || "Failed to test NWC connection. Check your NWC URI format.",
        loading: false 
      });
    }
  }
  
  // Test balances when values change (with debounce)
  // Only test after save or on blur, not on every keystroke
  useEffect(() => {
    // Don't auto-test on every keystroke - only after save
    // This prevents blocking input
  }, []);
  
  useEffect(() => {
    // Don't auto-test on every keystroke - only after save
    // This prevents blocking input
  }, []);

  function InputField({
    label,
    value,
    onChange,
    placeholder,
    error,
    isValid,
    helpText,
    showError,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    error?: string;
    isValid?: boolean;
    helpText?: string;
    showError?: boolean;
  }) {
    const displayError = showError && error;
    // Generate a unique id from the label
    const fieldId = `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const fieldName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (
      <div className="space-y-1">
        <label htmlFor={fieldId} className="block text-sm font-medium">{label}</label>
        <div className="relative">
          <input
            id={fieldId}
            name={fieldName}
            className={`w-full border p-2 text-black rounded ${
              displayError ? "border-red-500" : isValid ? "border-green-500" : "border-gray-300"
            }`}
            value={value}
            onChange={(e) => {
              // Simply update value without any validation or state blocking
              onChange(e.target.value);
            }}
            onBlur={(e) => {
              // Normalize URL (auto-add https:// if needed)
              const normalized = normalizeUrlOnBlur(e.target.value);
              if (normalized !== e.target.value) {
                onChange(normalized);
              }
              // Only validate on blur if validation was already shown (after save attempt)
              if (showValidation) {
                validateAll();
              }
            }}
            placeholder={placeholder}
          />
          {value && (
            <span className="absolute right-2 top-1/2 transform -translate-y-1/2">
              {displayError ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : isValid ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : null}
            </span>
          )}
        </div>
        {displayError && <p className="text-red-500 text-xs">{error}</p>}
        {!displayError && helpText && <p className="text-gray-500 text-xs">{helpText}</p>}
      </div>
    );
  }

  return (
    <div className="p-6">
      <SettingsHero title="Account" />
      
      {/* Security & Privacy Notice */}
      <div className="mt-6 mb-6 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-blue-400 mb-2">🔒 Privacy & Security</h3>
            <ul className="text-sm text-gray-300 space-y-1">
              <li className="flex items-start gap-2">
                <Lock className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <span><strong>Encrypted Storage:</strong> All wallet credentials (NWC secrets, LNbits admin keys) are encrypted with your password and stored in your browser's localStorage only.</span>
              </li>
              <li className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <span><strong>Client-Side Only:</strong> Secret keys NEVER leave your browser. All encryption/decryption happens locally using Web Crypto API.</span>
              </li>
              <li className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <span><strong>No Server Access:</strong> Your server never receives your wallet credentials. NWC connections go directly to Nostr relays, bypassing the server entirely.</span>
              </li>
            </ul>
            {hasNip05 ? (
              <p className="text-xs text-green-400 mt-3">
                ✓ Your account is verified with NIP-05: <strong>{metadata.nip05}</strong>
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-400">
                  💡 <strong>Secure your wallet data:</strong> Add a NIP-05 identifier to your profile, or enable encryption to protect your sensitive data with a password.
                </p>
                {!encryptionEnabled && (
                  <Link href="/settings/security">
                    <Button size="sm" variant="outline" className="mt-2">
                      <Lock className="h-4 w-4 mr-2" />
                      Enable Encryption
                    </Button>
                  </Link>
                )}
                {encryptionEnabled && !encryptionUnlocked && (
                  <p className="text-xs text-yellow-400">
                    ⚠️ Encryption is enabled but not unlocked. Please unlock encryption to view/edit settings.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="space-y-6">
        <section>
          <h2 className="text-xl font-bold mb-4">Payments - Receiving</h2>
          <p className="text-sm text-gray-400 mb-4">
            Configure how you receive payments. These will be used when someone zaps your repository or sends you a bounty payment.
          </p>
          <div className="space-y-4">
            <InputField
              label="LNURL"
              value={lnurl}
              onChange={setLnurl}
              placeholder="lnurl1... or https://..."
              error={errors.lnurl}
              isValid={validation.lnurl}
              showError={showValidation}
              helpText="Used for receiving Lightning payments via LNURL. https:// will be added automatically if needed."
            />
            <InputField
              label="Lightning address (LUD-16)"
              value={lud16}
              onChange={setLud16}
              placeholder="yourname@domain.com"
              error={errors.lud16}
              isValid={validation.lud16}
              showError={showValidation}
              helpText="Used for receiving Lightning payments via Lightning address"
            />
            <InputField
              label="NWC (Nostr Wallet Connect - Receive)"
              value={nwcRecv}
              onChange={setNwcRecv}
              placeholder="nostr+walletconnect://..."
              error={errors.nwcRecv}
              isValid={validation.nwcRecv}
              showError={showValidation}
              helpText="Used for receiving Lightning payments via Nostr Wallet Connect"
            />
            {/* Connection status display for receive wallet */}
            {nwcRecvBalance && (
              <div className={`mt-2 p-2 rounded text-sm ${
                nwcRecvBalance.error && !nwcRecvBalance.connected
                  ? "bg-red-900/30 border border-red-700 text-red-400"
                  : nwcRecvBalance.loading
                  ? "bg-yellow-900/30 border border-yellow-700 text-yellow-400"
                  : nwcRecvBalance.connected
                  ? "bg-green-900/30 border border-green-700 text-green-400"
                  : "bg-blue-900/30 border border-blue-700 text-blue-400"
              }`}>
                {nwcRecvBalance.loading && "Testing connection..."}
                {nwcRecvBalance.error && (
                  <div>
                    {nwcRecvBalance.connected ? (
                      <span>⚠️ {nwcRecvBalance.error}</span>
                    ) : (
                      <span>Error: {nwcRecvBalance.error}</span>
                    )}
                  </div>
                )}
                {!nwcRecvBalance.loading && !nwcRecvBalance.error && nwcRecvBalance.connected && (
                  <div>
                    {nwcRecvBalance.balance !== undefined ? (
                      <span>✓ NWC (Receive) connection verified - Balance: {nwcRecvBalance.balance} sats</span>
                    ) : (
                      <span>✓ NWC (Receive) connection verified</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Payments - Sending</h2>
          <p className="text-sm text-gray-400 mb-4">
            Configure how you send payments when you zap repositories or contributors.
          </p>
          <div className="space-y-4">
            <InputField
              label="NWC (Nostr Wallet Connect - Send)"
              value={nwcSend}
              onChange={setNwcSend}
              placeholder="nostr+walletconnect://..."
              error={errors.nwcSend}
              isValid={validation.nwcSend}
              showError={showValidation}
              helpText="Required for sending zaps. Used for single-recipient payments. Note: Some wallets (like minibits.cash) may not support balance queries but will still work for payments."
            />
            {/* Connection status display */}
            {nwcBalance && (
              <div className={`mt-2 p-2 rounded text-sm ${
                nwcBalance.error && !nwcBalance.connected
                  ? "bg-red-900/30 border border-red-700 text-red-400"
                  : nwcBalance.loading
                  ? "bg-yellow-900/30 border border-yellow-700 text-yellow-400"
                  : nwcBalance.connected
                  ? "bg-green-900/30 border border-green-700 text-green-400"
                  : "bg-blue-900/30 border border-blue-700 text-blue-400"
              }`}>
                {nwcBalance.loading && "Testing connection..."}
                {nwcBalance.error && (
                  <div>
                    {nwcBalance.connected ? (
                      <span>⚠️ {nwcBalance.error}</span>
                    ) : (
                      <span>Error: {nwcBalance.error}</span>
                    )}
                  </div>
                )}
                {!nwcBalance.loading && !nwcBalance.error && nwcBalance.connected && (
                  <div>
                    {nwcBalance.balance !== undefined ? (
                      <span>✓ NWC (Sending) connection verified - Balance: {nwcBalance.balance} sats</span>
                    ) : (
                      <span>✓ NWC (Sending) connection verified</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">LNbits Configuration</h2>
          <p className="text-sm text-gray-400 mb-4">
            Configure LNbits for split payments (repo zaps to multiple contributors) and bounties. If not set, defaults from environment will be used.
          </p>
          <div className="space-y-4">
            <InputField
              label="LNbits URL"
              value={lnbitsUrl}
              onChange={setLnbitsUrl}
              placeholder="your-lnbits-instance.com or https://..."
              error={errors.lnbitsUrl}
              isValid={validation.lnbitsUrl}
              showError={showValidation}
              helpText="Your LNbits instance URL (for split payments and bounties). Examples: bitcoindelta.club (v0.12.12) or azzamo.online (latest). https:// will be added automatically. The system automatically detects and supports both API versions."
            />
            <InputField
              label="LNbits Admin Key"
              value={lnbitsAdminKey}
              onChange={setLnbitsAdminKey}
              placeholder="Your LNbits admin API key"
              error={errors.lnbitsAdminKey}
              isValid={validation.lnbitsAdminKey}
              showError={showValidation}
              helpText="Admin API key from your LNbits instance (for creating/updating/deleting withdraw links - keep this secret!)"
            />
            <InputField
              label="LNbits Invoice Key (Read-Only)"
              value={lnbitsInvoiceKey}
              onChange={setLnbitsInvoiceKey}
              placeholder="Your LNbits invoice/read API key"
              error={errors.lnbitsInvoiceKey}
              isValid={validation.lnbitsInvoiceKey}
              showError={showValidation}
              helpText="Invoice/Read API key from your LNbits instance (for listing/reading withdraw links - optional but recommended for bounties)"
            />
            {/* Balance display */}
            {lnbitsBalance && (
              <div className={`mt-2 p-2 rounded text-sm ${
                lnbitsBalance.error 
                  ? "bg-red-900/30 border border-red-700 text-red-400"
                  : lnbitsBalance.loading
                  ? "bg-yellow-900/30 border border-yellow-700 text-yellow-400"
                  : "bg-green-900/30 border border-green-700 text-green-400"
              }`}>
                {lnbitsBalance.loading && "Testing connection..."}
                {lnbitsBalance.error && `Error: ${lnbitsBalance.error}`}
                {!lnbitsBalance.loading && !lnbitsBalance.error && lnbitsBalance.balance !== undefined && (
                  <span>✓ Balance: {lnbitsBalance.balance} sats</span>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">GitHub Profile</h2>
          <p className="text-sm text-gray-400 mb-4">
            Link your GitHub profile to show your avatar and automatically match contributors when importing repositories.
          </p>
          <div className="space-y-4">
            {githubProfile ? (
              <div className="space-y-3">
                <div className="p-3 bg-gray-800 border border-gray-700 rounded">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-300">Connected GitHub Profile</p>
                      <a
                        href={githubProfile}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-purple-400 hover:text-purple-300 mt-1 inline-block"
                      >
                        {githubProfile}
                      </a>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  </div>
                </div>
                <button
                  onClick={connectGitHub}
                  disabled={githubAuthenticating}
                  className="px-4 py-2 border border-gray-600 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 text-sm"
                >
                  {githubAuthenticating ? "Connecting..." : "Reconnect GitHub"}
                </button>
              </div>
            ) : (
              <button
                onClick={connectGitHub}
                disabled={githubAuthenticating}
                className="px-6 py-3 border border-purple-500 bg-purple-600 hover:bg-purple-700 rounded disabled:opacity-50 flex items-center gap-2"
              >
                {githubAuthenticating ? (
                  <>
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span>Connect with GitHub</span>
                  </>
                )}
              </button>
            )}
          </div>
        </section>

        <div className="flex items-center gap-3 pt-4">
          <button
            className={`px-4 py-2 rounded border ${
              showValidation && Object.keys(errors).length > 0
                ? "border-gray-500 bg-gray-700 cursor-not-allowed opacity-50"
                : "border-purple-500 bg-purple-600 hover:bg-purple-700 cursor-pointer"
            }`}
            onClick={saveAll}
            disabled={showValidation && Object.keys(errors).length > 0}
          >
            Save All Settings
          </button>
          {saved && (
            <span className={`${saved.includes("error") || saved.includes("fix") ? "text-red-400" : "text-green-400"}`}>
              {saved}
            </span>
          )}
        </div>

        {showValidation && Object.keys(errors).length > 0 && (
          <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-400">
              Please fix {Object.keys(errors).length} error{Object.keys(errors).length > 1 ? "s" : ""} before saving.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

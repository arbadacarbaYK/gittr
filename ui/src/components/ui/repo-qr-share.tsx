"use client";

import { useState, useEffect, useMemo } from "react";
import { Share2, MessageCircle, Copy, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getEventHash, signEvent, getPublicKey, nip19 } from "nostr-tools";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";

interface RepoQRShareProps {
  repoUrl: string; // e.g., /9a83779e/Pixelbot or full URL
  repoName: string; // Display name
  onClose: () => void;
}

export function RepoQRShare({ repoUrl, repoName, onClose }: RepoQRShareProps) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const { publish, defaultRelays, pubkey } = useNostrContext();

  // Get QR style from settings
  const [qrStyle, setQrStyle] = useState("classic");
  
  useEffect(() => {
    if (typeof window === "undefined") return;
    const style = localStorage.getItem("gittr_qr_style") || "classic";
    setQrStyle(style);
    
    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "gittr_qr_style") {
        setQrStyle(e.newValue || "classic");
      }
    };
    
    window.addEventListener("storage", handleStorageChange);
    
    // Listen for custom events (same-tab changes)
    const handleCustomEvent = () => {
      const style = localStorage.getItem("gittr_qr_style") || "classic";
      setQrStyle(style);
    };
    
    window.addEventListener("qr-style-changed", handleCustomEvent as EventListener);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("qr-style-changed", handleCustomEvent as EventListener);
    };
  }, []);

  // Get full URL
  const fullUrl = useMemo(() => {
    return repoUrl.startsWith("http") 
      ? repoUrl 
      : `${typeof window !== "undefined" ? window.location.origin : ""}${repoUrl}`;
  }, [repoUrl]);

  // Apply QR style via CSS after render
  useEffect(() => {
    // Wait for SVG to be fully rendered
    const applyStyles = () => {
      const container = document.getElementById("repo-qr-container");
      if (!container) return false;
      
      const svg = container.querySelector("svg");
      if (!svg) return false;

      // Get all rect elements (QR modules)
      const rects = Array.from(svg.querySelectorAll("rect"));
      if (rects.length === 0) return false; // QR not fully rendered yet
      
      if (qrStyle === "rounded") {
        // Apply rounded corners to QR code modules
        svg.style.borderRadius = "8px";
        rects.forEach((rect: any) => {
          rect.setAttribute("rx", "2");
          rect.setAttribute("ry", "2");
        });
        return true;
      } else if (qrStyle === "dots") {
        // Convert squares to circles for dots effect
        svg.style.borderRadius = "8px";
        rects.forEach((rect: any) => {
          const x = parseFloat(rect.getAttribute("x") || "0");
          const y = parseFloat(rect.getAttribute("y") || "0");
          const width = parseFloat(rect.getAttribute("width") || "1");
          const height = parseFloat(rect.getAttribute("height") || "1");
          const fill = rect.getAttribute("fill") || "black";
          
          // Convert rect to circle
          const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("cx", String(x + width / 2));
          circle.setAttribute("cy", String(y + height / 2));
          circle.setAttribute("r", String(Math.min(width, height) / 2));
          circle.setAttribute("fill", fill);
          
          rect.parentNode?.insertBefore(circle, rect);
          rect.remove();
        });
        return true;
      } else {
        // Classic: ensure no styling
        svg.style.borderRadius = "";
        return true;
      }
    };

    // Try immediately
    if (applyStyles()) return;

    // If not ready, retry with a small delay
    const timeout = setTimeout(() => {
      applyStyles();
    }, 100);

    return () => clearTimeout(timeout);
  }, [qrStyle, fullUrl]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const shareToTelegram = () => {
    // Telegram automatically adds the URL as a link preview, so we only include descriptive text
    // Don't include the URL in text - Telegram will add it automatically from the url parameter
    const text = encodeURIComponent(`📦 ${repoName}\n\nBuilt on Nostr ⚡`);
    // Use only the url parameter - Telegram will create the link preview automatically
    window.open(`https://t.me/share/url?url=${encodeURIComponent(fullUrl)}&text=${text}`, "_blank");
  };

  const shareToNostr = async () => {
    setSharing(true);

    try {
      // Check if user is logged in
      if (!pubkey) {
        alert("Please log in to share on Nostr.");
        setSharing(false);
        return;
      }

      // Check for NIP-07 extension first (user's own key via extension)
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      let signedEvent: any;
      
      // Create a Kind 1 note with the repo link
      const noteContent = `📦 ${repoName}\n\n${fullUrl}\n\n#gittr #nostr`;
      
      // Create the event
      const event: any = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["t", "gittr"],
          ["t", "nostr"],
          ["r", fullUrl],
        ],
        content: noteContent,
        pubkey: pubkey,
        id: "",
        sig: "",
      };
      
      event.id = getEventHash(event);

      // Sign with NIP-07 (user's own key) or private key
      if (hasNip07 && window.nostr) {
        // Use NIP-07 extension - user signs with their own key
        try {
          signedEvent = await window.nostr.signEvent(event);
        } catch (signError: any) {
          if (signError.message?.includes("cancel") || signError.message?.includes("reject") || signError.message?.includes("User rejected")) {
            // User canceled - don't show error
            setSharing(false);
            return;
          }
          throw signError;
        }
      } else {
        // Fallback to private key if available
        const privateKey = typeof window !== "undefined" ? await getNostrPrivateKey() : null;
        if (!privateKey) {
          alert("Please log in with NIP-07 extension or configure a private key to share on Nostr.");
          setSharing(false);
          return;
        }
        event.sig = signEvent(event, privateKey);
        signedEvent = event;
      }

      // Publish to relays
      if (publish && defaultRelays && defaultRelays.length > 0) {
        try {
          publish(signedEvent, defaultRelays);
          setShared(true);
          setTimeout(() => {
            setShared(false);
          }, 3000);
        } catch (publishError: any) {
          console.error("Publish error:", publishError);
          // Fallback: copy to clipboard
          await navigator.clipboard.writeText(noteContent);
          alert(`Note created! Copied to clipboard. Publish status: ${publishError.message || "unknown"}`);
        }
      } else {
        // No publish function available, copy to clipboard
        await navigator.clipboard.writeText(noteContent);
        alert("Note copied! Paste it into your Nostr client to share.");
      }
    } catch (err: any) {
      console.error("Failed to share to Nostr:", err);
      alert(`Failed to share: ${err.message || "Unknown error"}`);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="theme-bg-primary theme-border border rounded-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Share Repository</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <p className="text-center text-gray-300 mb-4">{repoName}</p>
        
        <div className="flex justify-center mb-4">
          <div className={`bg-white p-4 ${qrStyle === "rounded" ? "rounded-2xl" : qrStyle === "dots" ? "rounded-full" : "rounded-lg"}`} id="repo-qr-container">
            <QRCodeSVG
              key={`repo-qr-${qrStyle}-${fullUrl?.substring(0, 20)}`}
              value={fullUrl}
              size={256}
              level="M"
              includeMargin={false}
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Button
            onClick={copyUrl}
            className="w-full"
            variant="outline"
          >
            <Copy className="mr-2 h-4 w-4" />
            {copied ? "Copied!" : "Copy Link"}
          </Button>
          
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={shareToTelegram}
              className="theme-bg-accent-primary"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              Telegram
            </Button>
            
            <Button
              onClick={shareToNostr}
              variant="default"
              disabled={sharing}
            >
              <Share2 className="mr-2 h-4 w-4" />
              {sharing ? "Sharing..." : shared ? "Shared!" : "Nostr"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


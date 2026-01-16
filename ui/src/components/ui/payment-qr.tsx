"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { CheckCircle, Copy, Download, X } from "lucide-react";
import { getEventHash, getPublicKey, nip04, signEvent } from "nostr-tools";
import { QRCodeSVG } from "qrcode.react";

// NIP-44 is only available in nostr-tools v2.x+, so we'll import it conditionally at runtime
// This avoids build errors when nip44 doesn't exist in v1.7.4
let nip44: any = undefined;
if (typeof window !== "undefined") {
  try {
    // Try to import nip44 dynamically - will be undefined if not available (v1.7.4)
    const nostrTools = require("nostr-tools");
    if (nostrTools.nip44) {
      nip44 = nostrTools.nip44;
    }
  } catch (e) {
    // nip44 not available in this version
  }
}

interface PaymentQRProps {
  invoice: string | null; // Lightning invoice (BOLT11) - null if error
  amount?: number;
  paymentHash?: string; // For status checking
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
  nwcUri?: string | null; // NWC URI for "Pay via NWC" button
  onClose: () => void;
  onPaid?: () => void; // Callback when payment is confirmed
  extra?: React.ReactNode; // Optional extra content (e.g., mode selection, notes)
  error?: string | null; // Optional error message to display
}

export function PaymentQR({
  invoice,
  amount,
  paymentHash,
  lnbitsUrl,
  lnbitsAdminKey,
  nwcUri: propNwcUri,
  onClose,
  onPaid,
  extra,
  error,
}: PaymentQRProps) {
  const [copied, setCopied] = useState(false);
  const [nwcUri, setNwcUri] = useState<string | null>(propNwcUri || null);
  const [paid, setPaid] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    "pending" | "paid" | "checking"
  >("pending");
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const cleanInvoice = (invoice || "").replace(/^lightning:/i, "");

  // Get QR style from settings
  const [qrStyle, setQrStyle] = useState("classic");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const style = localStorage.getItem("gittr_qr_style") || "classic";
    setQrStyle(style);

    // Listen for storage changes (when QR style is changed in settings)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "gittr_qr_style") {
        setQrStyle(e.newValue || "classic");
      }
    };

    window.addEventListener("storage", handleStorageChange);

    // Also listen for custom events (same-tab changes)
    const handleCustomEvent = () => {
      const style = localStorage.getItem("gittr_qr_style") || "classic";
      setQrStyle(style);
    };

    window.addEventListener(
      "qr-style-changed",
      handleCustomEvent as EventListener
    );

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "qr-style-changed",
        handleCustomEvent as EventListener
      );
    };
  }, []);

  // Apply QR style via CSS after render
  useEffect(() => {
    // Wait for SVG to be fully rendered
    const applyStyles = () => {
      const container = document.getElementById("qr-container");
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
          const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle"
          );
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
  }, [qrStyle, cleanInvoice]);

  // Detect NWC send configuration (for Pay with NWC)
  // Use prop if provided, otherwise load from localStorage
  useEffect(() => {
    if (propNwcUri) {
      setNwcUri(propNwcUri);
      return;
    }

    try {
      const uri =
        typeof window !== "undefined"
          ? localStorage.getItem("gittr_nwc_send")
          : null;
      if (uri && uri.trim().length > 0) {
        setNwcUri(uri);
      } else {
        setNwcUri(null);
      }
    } catch (err) {
      console.error("PaymentQR: Error reading NWC send URI:", err);
      setNwcUri(null);
    }
  }, [propNwcUri]);

  const canUseWebLN = useMemo(() => {
    return typeof window !== "undefined" && (window as any).webln;
  }, []);

  const fetchNWCInfoEvent = async (
    relay: string,
    walletPubkey: string
  ): Promise<any | null> => {
    return new Promise((resolve) => {
      const ws = new WebSocket(relay);
      const subId = `nwc-info-${Date.now()}`;
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve(null);
        }
      }, 10000); // 10 second timeout

      ws.onopen = () => {
        const subscription = [
          "REQ",
          subId,
          {
            kinds: [13194],
            authors: [walletPubkey],
            limit: 1,
          },
        ];
        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (message) => {
        try {
          const data = JSON.parse(message.data);

          // Handle EOSE
          if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subId) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              ws.send(JSON.stringify(["CLOSE", subId]));
              ws.close();
              resolve(null); // No info event found
            }
            return;
          }

          // Handle EVENT
          if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subId) {
            const event = data[2];
            if (
              event &&
              event.kind === 13194 &&
              event.pubkey === walletPubkey
            ) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                ws.send(JSON.stringify(["CLOSE", subId]));
                ws.close();
                resolve(event);
              }
            }
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          resolve(null);
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      };
    });
  };

  const payWithNwc = async () => {
    // Re-check NWC URI from localStorage (in case it was just configured)
    const currentNwcUri =
      typeof window !== "undefined"
        ? localStorage.getItem("gittr_nwc_send")
        : null;
    const uriToUse =
      currentNwcUri && currentNwcUri.trim().length > 0 ? currentNwcUri : nwcUri;

    if (!uriToUse) {
      alert("NWC not configured. Set NWC Send in Settings → Account.");
      return;
    }

    try {
      setPaymentStatus("checking");

      if (canUseWebLN) {
        const webln = (window as any).webln;
        if (webln && webln.enable) {
          await webln.enable();
        }
        if (webln && webln.sendPayment) {
          try {
            await webln.sendPayment(cleanInvoice);
            if (paymentHash) setTimeout(() => checkPaymentStatus(), 1500);
            else setPaymentStatus("pending");
            return;
          } catch (weblnError: any) {
            // Fall through to NWC
          }
        }
      }

      try {
        const normalizedUri = uriToUse.replace(
          /^nostr\+walletconnect:/,
          "http:"
        );
        const uri = new URL(normalizedUri);
        const walletPubkey =
          uri.hostname || uri.pathname.replace(/^\/+/, "").replace(/\/$/, "");
        const relay = uri.searchParams.get("relay");
        const secret = uri.searchParams.get("secret");
        if (!walletPubkey || !relay || !secret) {
          throw new Error(
            `Invalid NWC URI: missing walletPubkey, relay, or secret`
          );
        }

        const sk = secret;
        const clientPubkey = getPublicKey(sk);
        setPaymentStatus("checking");

        let walletCapabilities: string[] = [];
        let supportedEncryption: string[] = ["nip04"];
        let useNip44 = false;

        try {
          const infoEvent = await fetchNWCInfoEvent(relay, walletPubkey);
          if (infoEvent) {
            walletCapabilities = infoEvent.content
              .split(/\s+/)
              .filter((c: string) => c.length > 0);
            const encryptionTag = infoEvent.tags?.find(
              (tag: any) => tag[0] === "encryption"
            );
            if (encryptionTag && encryptionTag[1]) {
              supportedEncryption = encryptionTag[1]
                .split(/\s+/)
                .filter((e: string) => e.length > 0);
            }
            useNip44 =
              supportedEncryption.includes("nip44_v2") ||
              supportedEncryption.includes("nip44");

            if (!walletCapabilities.includes("pay_invoice")) {
              throw new Error(
                `Wallet does not support pay_invoice. Supported methods: ${walletCapabilities.join(
                  ", "
                )}`
              );
            }
          }
        } catch (infoError: any) {
          // Continue with NIP-04 as fallback
        }

        const requestPayload = {
          method: "pay_invoice",
          params: {
            invoice: cleanInvoice,
          },
        };

        let encryptedContent: string;
        const encryptionScheme = useNip44 ? "nip44_v2" : "nip04";
        const hasNip44 =
          typeof nip44 !== "undefined" &&
          nip44 &&
          typeof nip44.encrypt === "function";

        if (useNip44 && hasNip44) {
          try {
            encryptedContent = await nip44.encrypt(
              sk,
              walletPubkey,
              JSON.stringify(requestPayload)
            );
          } catch (nip44Error: any) {
            encryptedContent = await nip04.encrypt(
              sk,
              walletPubkey,
              JSON.stringify(requestPayload)
            );
          }
        } else {
          encryptedContent = await nip04.encrypt(
            sk,
            walletPubkey,
            JSON.stringify(requestPayload)
          );
        }

        const paymentEvent: any = {
          kind: 23194,
          content: encryptedContent,
          tags: [
            ["p", walletPubkey],
            ["encryption", encryptionScheme],
          ],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: clientPubkey,
        };

        paymentEvent.id = getEventHash(paymentEvent);
        paymentEvent.sig = signEvent(paymentEvent, sk);

        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(relay);
          let requestAccepted = false;
          let requestSent = false;

          ws.onopen = () => {
            ws.send(JSON.stringify(["EVENT", paymentEvent]));
            requestSent = true;
          };

          ws.onmessage = (message) => {
            try {
              const data = JSON.parse(message.data);
              if (Array.isArray(data) && data[0] === "OK") {
                const eventId = data[1];
                const accepted = data[2];

                if (eventId === paymentEvent.id) {
                  requestAccepted = accepted;
                  if (accepted) {
                    ws.close();
                    setPaymentStatus("checking");
                    if (paymentHash) {
                      setTimeout(() => checkPaymentStatus(), 1500);
                    } else {
                      setPaymentStatus("pending");
                    }
                    resolve();
                  } else {
                    const reason = data[3] || "unknown";
                    ws.close();
                    reject(
                      new Error(`Payment request rejected by relay: ${reason}`)
                    );
                  }
                }
              }
            } catch (error) {
              console.error("NWC: Error parsing message:", error);
            }
          };

          ws.onerror = (error) => {
            ws.close();
            reject(new Error(`WebSocket error: ${error}`));
          };

          ws.onclose = (event) => {
            if (!requestAccepted && requestSent) {
              setPaymentStatus("checking");
              if (paymentHash) {
                setTimeout(() => checkPaymentStatus(), 1500);
              }
              resolve();
            }
          };

          setTimeout(() => {
            if (!requestAccepted && ws.readyState === WebSocket.OPEN) {
              ws.close();
              if (requestSent) {
                setPaymentStatus("checking");
                if (paymentHash) {
                  setTimeout(() => checkPaymentStatus(), 1500);
                }
                resolve();
              } else {
                reject(
                  new Error(
                    "WebSocket timeout - failed to send payment request"
                  )
                );
              }
            }
          }, 10000);
        });
      } catch (protoErr: any) {
        console.error("NWC protocol error:", protoErr);
        setPaymentStatus("pending");
        alert(`Failed to pay via NWC: ${protoErr.message || "Protocol error"}`);
      }
    } catch (error: any) {
      console.error("NWC payment error:", error);
      setPaymentStatus("pending");
      alert(
        `Failed to pay via NWC: ${
          error.message || "Please try again or scan the QR"
        }`
      );
    }
  };

  const checkPaymentStatus = async () => {
    if (!paymentHash || !lnbitsUrl || !lnbitsAdminKey) return;

    try {
      const params = new URLSearchParams({
        paymentHash,
        lnbitsUrl,
        lnbitsAdminKey,
      });

      const response = await fetch(`/api/payment/status?${params}`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.paid) {
        setPaid(true);
        setPaymentStatus("paid");
        // Call onPaid callback to record accumulated zap
        if (onPaid) {
          onPaid();
        }
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error("Payment status check failed:", error);
    }
  };

  // Poll payment status if we have paymentHash
  useEffect(() => {
    if (paymentHash && lnbitsUrl && lnbitsAdminKey && !paid) {
      // Initial check
      checkPaymentStatus();
      // Poll every 3 seconds
      pollingIntervalRef.current = setInterval(checkPaymentStatus, 3000);
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [paymentHash, lnbitsUrl, lnbitsAdminKey, paid]);

  const copyInvoice = async () => {
    try {
      const invoiceToCopy = cleanInvoice || invoice || "";
      if (!invoiceToCopy) {
        return;
      }
      await navigator.clipboard.writeText(invoiceToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy invoice:", err);
      alert(
        "Failed to copy invoice. Please try manually selecting the QR code."
      );
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="theme-bg-primary theme-border border rounded-lg p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Pay Lightning Invoice</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {extra}

        {amount && !error && (
          <p className="text-center text-lg mb-2">
            <span className="text-purple-500 font-semibold">{amount}</span> sats
            {paid && (
              <span className="ml-2 text-green-500 flex items-center justify-center gap-1">
                <CheckCircle className="h-5 w-5" />
                Paid!
              </span>
            )}
          </p>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-900/20 border border-red-700 rounded-lg">
            <p className="text-red-400 text-sm whitespace-pre-line">{error}</p>
          </div>
        )}

        {paymentStatus === "checking" && !paid && !error && (
          <p className="text-center text-sm text-yellow-500 mb-2">
            Checking payment status...
          </p>
        )}

        {invoice && !error && (
          <div className="flex justify-center mb-4">
            <div
              className={`bg-white p-4 ${
                qrStyle === "rounded" || qrStyle === "dots"
                  ? "rounded-2xl"
                  : "rounded-lg"
              } ${paid ? "opacity-50" : ""}`}
              id="qr-container"
            >
              <QRCodeSVG
                key={`qr-${qrStyle}-${cleanInvoice?.substring(0, 20)}`}
                value={cleanInvoice}
                size={256}
                level="M"
                includeMargin={true}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
          </div>
        )}

        {invoice && !error && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                onClick={copyInvoice}
                className="flex-1 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors theme-border border theme-bg-secondary theme-text-primary hover:opacity-80 focus:outline-none focus:ring-0 disabled:opacity-50 disabled:pointer-events-none h-10 py-2 px-4"
              >
                <Copy className="mr-2 h-4 w-4" />
                {copied ? "Copied!" : "Copy Invoice"}
              </button>
              <button
                onClick={() => {
                  const container = document.getElementById("qr-container");
                  if (!container) return;
                  const svg = container.querySelector("svg");
                  if (!svg) return;

                  const svgData = new XMLSerializer().serializeToString(svg);
                  const canvas = document.createElement("canvas");
                  const ctx = canvas.getContext("2d");
                  const img = new Image();

                  canvas.width = 256;
                  canvas.height = 256;

                  img.onload = () => {
                    ctx?.drawImage(img, 0, 0);
                    canvas.toBlob((blob) => {
                      if (!blob) return;
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `payment-qr-${Date.now()}.png`;
                      link.click();
                      URL.revokeObjectURL(url);
                    });
                  };

                  img.src = "data:image/svg+xml;base64," + btoa(svgData);
                }}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors theme-border border theme-bg-secondary theme-text-primary hover:opacity-80 focus:outline-none focus:ring-0 disabled:opacity-50 disabled:pointer-events-none h-10 py-2 px-4"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>

            {nwcUri && (
              <Button onClick={payWithNwc} className="w-full" variant="default">
                Pay with NWC
              </Button>
            )}

            <Button
              onClick={() => {
                // Use window.location.href for better mobile compatibility with custom URL schemes
                // This works on both mobile and desktop browsers
                window.location.href = `lightning:${cleanInvoice}`;
              }}
              className="w-full theme-bg-accent-primary"
            >
              Open in Wallet
            </Button>

            <p className="text-xs text-gray-400 mt-2 text-center">
              Scan with a Lightning wallet to pay
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

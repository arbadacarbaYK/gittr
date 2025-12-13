"use client";

import { useCallback, useRef, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { LoginType, checkType } from "@/lib/utils";

import { Puzzle, Shield, X, Camera, Scan } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { nip05, nip19 } from "nostr-tools";
import { Html5Qrcode } from "html5-qrcode";

export default function Login() {
  const { setAuthor, remoteSigner } = useNostrContext();
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement>(null);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  // Use state for NIP-07 detection to prevent hydration mismatch
  const [hasNip07, setHasNip07] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Check for NIP-07 extension after mount (prevents hydration mismatch)
  useEffect(() => {
    setMounted(true);
    setHasNip07(typeof window !== "undefined" && typeof window.nostr !== "undefined");
  }, []);

  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const qrScanAreaRef = useRef<HTMLDivElement>(null);

  // TODO : setAuthor needs to be tweaked (don't remove but tweak *_*)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await handleLogin();
  };

  const handleLogin = useCallback(async () => {
    const cred = inputRef.current?.value || "";
    let loginType = checkType(cred);
    let npub = "";

    // Checking for nip07 extension
    loginType = window.nostr && cred === "" ? LoginType.nip07 : loginType;

    // Else use common credentials
    switch (loginType) {
      case LoginType.npub:
        npub = cred;
        break;
      case LoginType.hex:
        npub = nip19.npubEncode(cred);
        break;
      case LoginType.nip07:
        const hex = await window.nostr.getPublicKey();
        npub = nip19.npubEncode(hex);
        break;
      case LoginType.nip05:
        const profile = await nip05.queryProfile(cred);
        npub = nip19.npubEncode(profile?.pubkey || "");
      default:
        break;
    }
    // Set Author and return to root
    setAuthor && setAuthor(npub);
    router.push("/");
  }, [setAuthor, router]);

  const remoteSession = remoteSigner?.getSession();

  const handleRemoteConnect = useCallback(async () => {
    if (!remoteSigner) {
      setRemoteError("Remote signer manager not ready yet. Please try again in a moment.");
      return;
    }
    if (!remoteToken.trim()) {
      setRemoteError("Paste a bunker:// or nostrconnect:// token.");
      return;
    }
    setRemoteBusy(true);
    setRemoteError(null);
    try {
      const result = await remoteSigner.connect(remoteToken.trim());
      // After successful pairing, log the user in with their pubkey
      if (result?.npub && setAuthor) {
        setAuthor(result.npub);
      } else {
        // Fallback: get pubkey from session and convert to npub
        const session = remoteSigner?.getSession();
        if (session?.userPubkey && setAuthor) {
          const npub = nip19.npubEncode(session.userPubkey);
          setAuthor(npub);
        }
      }
      setRemoteBusy(false);
      setRemoteModalOpen(false);
      setRemoteToken("");
      router.push("/");
    } catch (error: any) {
      console.error("[Login] Remote signer pairing failed:", error);
      setRemoteBusy(false);
      setRemoteError(error?.message || "Unable to pair with remote signer");
    }
  }, [remoteSigner, remoteToken, router, setAuthor]);

  const handleRemoteDisconnect = useCallback(() => {
    remoteSigner?.disconnect();
    setRemoteToken("");
    setRemoteError(null);
  }, [remoteSigner]);

  // QR Scanner functions
  const stopQRScanner = useCallback(async () => {
    if (qrScannerRef.current) {
      try {
        await qrScannerRef.current.stop();
      } catch (err: any) {
        console.warn("[Login] Error stopping QR scanner:", err);
      }
      qrScannerRef.current.clear();
      qrScannerRef.current = null;
    }
    setShowQRScanner(false);
  }, []);

  const startQRScanner = useCallback(async () => {
    // Wait for the DOM element to be available
    setShowQRScanner(true);
    
    // Use setTimeout to ensure DOM is updated
    setTimeout(async () => {
      const container = document.getElementById("qr-scanner-container");
      if (!container) {
        console.error("[Login] QR scanner container not found");
        setRemoteError("QR scanner container not found. Please try again.");
        setShowQRScanner(false);
        return;
      }
      
      try {
        // Stop any existing scanner first
        if (qrScannerRef.current) {
          await qrScannerRef.current.stop().catch(() => {});
          qrScannerRef.current.clear();
        }
        
        const scanner = new Html5Qrcode("qr-scanner-container");
        qrScannerRef.current = scanner;
        
        await scanner.start(
          { facingMode: "environment" }, // Use back camera on mobile
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            // Successfully scanned a QR code
            console.log("[Login] QR code scanned:", decodedText);
            stopQRScanner().catch(console.error);
            
            // Validate it's a bunker:// or nostrconnect:// URI
            if (decodedText.startsWith("bunker://") || decodedText.startsWith("nostrconnect://")) {
              setRemoteToken(decodedText);
              setRemoteError(null);
            } else {
              setRemoteError("Scanned QR code is not a valid bunker:// or nostrconnect:// token");
            }
          },
          (errorMessage) => {
            // Scanning failed or no QR code found - ignore, keep scanning
            // Only log if it's not the expected "No QR code found" message
            if (!errorMessage.includes("No QR code found") && !errorMessage.includes("NotFoundException")) {
              console.debug("[Login] QR scan:", errorMessage);
            }
          }
        );
      } catch (error: any) {
        console.error("[Login] Failed to start QR scanner:", error);
        setRemoteError(`Camera access failed: ${error.message || "Please allow camera permissions"}`);
        setShowQRScanner(false);
        if (qrScannerRef.current) {
          qrScannerRef.current.clear();
        }
      }
    }, 100); // Small delay to ensure DOM is ready
  }, [stopQRScanner]);

  // Cleanup scanner on unmount or modal close
  useEffect(() => {
    if (!remoteModalOpen) {
      stopQRScanner().catch(console.error);
    }
    return () => {
      stopQRScanner().catch(console.error);
    };
  }, [remoteModalOpen, stopQRScanner]);

  // Auto-login with NIP-07 extension if available
  useEffect(() => {
    // Only attempt auto-login once
    if (autoLoginAttempted) return;
    
    const attemptAutoLogin = async () => {
      // Check if NIP-07 extension is available
      if (typeof window !== "undefined" && window.nostr) {
        try {
          setAutoLoginAttempted(true);
          // Try to get public key to verify extension is ready
          await window.nostr.getPublicKey();
          // Extension is ready, auto-login
          await handleLogin();
        } catch (error) {
          // Extension not ready or user denied, don't auto-login
          console.log("[Login] NIP-07 extension detected but not ready for auto-login:", error);
          setAutoLoginAttempted(false); // Allow retry
        }
      }
    };
    
    // Try immediately
    attemptAutoLogin();
    
    // Also try after a delay (extensions may inject window.nostr asynchronously)
    const timer1 = setTimeout(attemptAutoLogin, 500);
    const timer2 = setTimeout(attemptAutoLogin, 1500);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [autoLoginAttempted, handleLogin]);

  return (
    <>
      <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <Image
            width={500}
            height={500}
            className="mx-auto h-12 w-auto"
            src="/logo.svg"
            alt="NostrGit"
          />
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight">
            Sign in
          </h1>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-[#171B21] py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {/* Remote Signer Option - Prominent */}
            <div className="space-y-2 mb-6">
              <Button
                variant="outline"
                type="button"
                className="flex w-full items-center justify-center gap-2 border-purple-700/50 hover:border-purple-600"
                onClick={() => {
                  setRemoteModalOpen(true);
                  setRemoteError(null);
                }}
              >
                <Shield className="h-4 w-4" />
                {remoteSession ? "Reconnect Remote Signer" : "Pair Remote Signer (NIP-46)"}
              </Button>
              <p className="text-xs text-gray-400 text-center">
                Paste or scan a <code className="font-mono text-purple-400">bunker://</code> or{" "}
                <code className="font-mono text-purple-400">nostrconnect://</code> token from your hardware signer.
              </p>
              {remoteSession ? (
                <div className="rounded border border-purple-700/40 bg-purple-950/30 px-3 py-2 text-xs text-purple-100">
                  <p className="font-semibold text-purple-300">Remote signer paired</p>
                  <p className="mt-1 break-all text-[11px] text-purple-200/80">{remoteSession.userPubkey}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-7 text-xs text-purple-300 hover:text-white"
                    onClick={handleRemoteDisconnect}
                  >
                    Disconnect remote signer
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-lightgray" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-[#171B21] px-2 text-gray-500">OR</span>
              </div>
            </div>

            {/* Traditional Login Form */}
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <div className="flex justify-between">
                  <label
                    htmlFor="key"
                    className="block text-sm font-medium leading-6"
                  >
                    npub, hex pubkey, or NIP-05 name
                  </label>
                  <label
                    htmlFor="key"
                    className="text-sm font-medium leading-6"
                  >
                    <a
                      href="https://nostr.how/get-started"
                      className="font-bold font-medium text-purple-500"
                    >
                      What are these?
                    </a>
                  </label>
                </div>
                <div className="mt-2">
                  <Input
                    id="key"
                    name="key"
                    type="text"
                    required
                    className="w-fulls block"
                    ref={inputRef}
                  />
                </div>
              </div>

              <div>
                <Button
                  variant={"success"}
                  type="submit"
                  className="flex w-full justify-center"
                >
                  Sign in
                </Button>
              </div>
            </form>
            {mounted && hasNip07 ? (
              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-lightgray" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-[#171B21] px-2 text-gray-500">OR</span>
                  </div>
                </div>
                <div className="mt-6">
                  <Button
                    variant="outline"
                    className="flex justify-center gap-2 items-center w-full"
                    onClick={handleLogin}
                  >
                    <Puzzle />
                    <p className="text-center">Continue with extension</p>
                  </Button>
                  <p className="mt-2 text-xs text-gray-400 text-center">
                    ✓ NIP-07 extension detected. You will be signed in automatically, or click above to sign in manually.
                  </p>
                </div>
              </div>
            ) : mounted ? (
              <div className="mt-6">
                <div className="relative">
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2">Or</span>
                  </div>
                </div>
                <div className="mt-6">
                  <div className="relative">
                    <div className="relative flex justify-center text-center text-sm">
                      <span className="px-2 text-gray-400">
                        <span className="mr-1">
                          For better security, download a NIP-07 extension like
                        </span>
                        <a
                          className="underline text-purple-400 hover:text-purple-300"
                          href="https://www.getflamingo.org"
                        target="_blank"
                        rel="noreferrer"
                        >
                          Flamingo
                        </a>
                        <span className="ml-1 mr-1">or</span>
                        <a
                          className="underline text-purple-400 hover:text-purple-300"
                          href="https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/"
                        target="_blank"
                        rel="noreferrer"
                        >
                          nos2x-fox
                        </a>
                        .
                        <span className="block mt-2 text-gray-400 text-xs">
                          On mobile browsers without extensions, install{" "}
                          <a
                            className="underline"
                            href="https://github.com/haorendashu/nowser"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Nowser
                          </a>{" "}
                          to sign via NIP-46/NIP-07.
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // Server-side render: show placeholder to match client initial render
              <div className="mt-6">
                <div className="relative">
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2">Or</span>
                  </div>
                </div>
                <div className="mt-6">
                  <div className="relative">
                    <div className="relative flex justify-center text-center text-sm">
                      <span className="px-2">
                        <span className="mr-1">
                          For better security, download a NIP-07 extension like
                        </span>
                        <a
                          className="underline"
                          href="https://www.getflamingo.org"
                        target="_blank"
                        rel="noreferrer"
                        >
                          Flamingo
                        </a>
                        <span className="ml-1 mr-1">or</span>
                        <a
                          className="underline"
                          href="https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/"
                        target="_blank"
                        rel="noreferrer"
                        >
                          nos2x-fox
                        </a>
                        .
                        <span className="block mt-2 text-gray-400 text-xs">
                          On mobile browsers without extensions, install{" "}
                          <a
                            className="underline"
                            href="https://github.com/haorendashu/nowser"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Nowser
                          </a>{" "}
                          to sign via NIP-46/NIP-07.
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-center center mt-1">
            <p>
              Don&apos;t have a
              <a href="https://nostr.how/">
                <b className="font-medium text-purple-500 ml-1 mr-1">Nostr</b>
              </a>
              profile?
            </p>
            <a href="/signup" className="font-medium text-purple-500 ml-1">
              Create one here.
            </a>
          </div>
        </div>
      </div>
      {remoteModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-xl border border-purple-800/40 bg-[#0f1117] p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Pair Remote Signer (NIP-46)</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Scan or paste the <code className="font-mono text-purple-400">bunker://</code> QR/text shown on your remote signer device.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRemoteModalOpen(false)}
                className="rounded-full p-1 text-gray-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <label htmlFor="remote-token" className="text-sm font-medium flex-1">
                  Remote signer token
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (showQRScanner) {
                      await stopQRScanner();
                      setShowQRScanner(false);
                    } else {
                      await startQRScanner();
                    }
                  }}
                  className="flex items-center gap-1.5"
                >
                  {showQRScanner ? (
                    <>
                      <X className="h-3.5 w-3.5" />
                      Stop Camera
                    </>
                  ) : (
                    <>
                      <Camera className="h-3.5 w-3.5" />
                      Scan QR
                    </>
                  )}
                </Button>
              </div>
              {showQRScanner ? (
                <div
                  ref={qrScanAreaRef}
                  id="qr-scanner-container"
                  className="w-full rounded-lg border border-purple-800/40 bg-black/50 overflow-hidden"
                  style={{ minHeight: "250px" }}
                />
              ) : (
                <Input
                  id="remote-token"
                  name="remote-token"
                  placeholder="bunker://<pubkey>?relay=wss://..."
                  value={remoteToken}
                  onChange={(e) => setRemoteToken(e.target.value)}
                  className="font-mono text-xs"
                />
              )}
              {remoteError ? (
                <p className="text-sm text-red-400">
                  {remoteError}
                </p>
              ) : null}
              <p className="text-xs text-gray-400">
                Learn more about this flow in{" "}
                <a
                  href="https://nips.nostr.com/46"
                  className="text-purple-400 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  NIP-46 (Remote Signing)
                </a>
                . Pairing stores only the ephemeral client key for reconnecting; sign out to fully remove it.
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button
                className="flex-1"
                onClick={handleRemoteConnect}
                disabled={remoteBusy}
              >
                {remoteBusy ? "Pairing..." : "Pair & Login"}
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setRemoteModalOpen(false);
                  setRemoteError(null);
                  setRemoteBusy(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
  </>
  );
}

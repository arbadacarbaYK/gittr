"use client";

import { useCallback, useRef, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { LoginType, checkType } from "@/lib/utils";

import { Puzzle } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { nip05, nip19, getPublicKey } from "nostr-tools";

export default function Login() {
  const { setAuthor } = useNostrContext();
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
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <div className="flex justify-between">
                  <label
                    htmlFor="key"
                    className="block text-sm font-medium leading-6"
                  >
                    <span className="line-through">nsec</span>, npub,{" "}
                    <span className="line-through">nip-05 or hex</span>
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
    </>
  );
}

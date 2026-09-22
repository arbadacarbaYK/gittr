"use client";

import { useState } from "react";

import { showToast } from "@/components/ui/toast";

import { Check, Share2 } from "lucide-react";

import { directoryCardShareUrl } from "./directory-card-share";

export function DirectoryCardShareButton({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!directoryCardShareUrl(url, "https://gittr.space")) return null;

  const onShare = async () => {
    const shareUrl = directoryCardShareUrl(
      url,
      window.location.origin || "https://gittr.space"
    );
    if (!shareUrl) return;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title, url: shareUrl });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      showToast("Link copied", "success");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("Could not copy the link", "error");
    }
  };

  return (
    <button
      type="button"
      aria-label={copied ? "Link copied" : `Share ${title}`}
      title={copied ? "Link copied" : "Share"}
      className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-[#171B21] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-primary)]"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void onShare();
      }}
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Share2 className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

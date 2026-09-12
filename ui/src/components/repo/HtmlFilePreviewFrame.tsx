"use client";

import { useEffect, useState } from "react";

import {
  HTML_PREVIEW_HEIGHT_MESSAGE,
  HTML_PREVIEW_IFRAME_SANDBOX,
  injectHtmlPreviewAutoHeight,
} from "@/lib/gittr-pages/html-preview-base";

const MIN_FRAME_PX = 640;

function isPreviewIframeOrigin(origin: string): boolean {
  return (
    origin === "null" ||
    (typeof window !== "undefined" && origin === window.location.origin)
  );
}

/**
 * Code-tab HTML preview. srcDoc iframes cannot be read for height (no
 * allow-same-origin), so the page reports scrollHeight via postMessage.
 */
export function HtmlFilePreviewFrame({
  html,
  title,
}: {
  html: string;
  title: string;
}) {
  const [height, setHeight] = useState(MIN_FRAME_PX);
  const srcDoc = injectHtmlPreviewAutoHeight(html);

  useEffect(() => {
    setHeight(MIN_FRAME_PX);
    const onMessage = (event: MessageEvent) => {
      if (!isPreviewIframeOrigin(event.origin)) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (!data || data.type !== HTML_PREVIEW_HEIGHT_MESSAGE) return;
      const next = Math.ceil(Number(data.height) || 0);
      if (!Number.isFinite(next) || next < 1) return;
      setHeight((prev) => {
        const clamped = Math.max(MIN_FRAME_PX, Math.min(next + 16, 200_000));
        if (Math.abs(clamped - prev) < 16) return prev;
        return clamped;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html]);

  return (
    <iframe
      srcDoc={srcDoc}
      className="w-full border-0"
      title={title}
      scrolling="no"
      style={{
        height,
        display: "block",
        minHeight: MIN_FRAME_PX,
        overflow: "hidden",
      }}
      sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
    />
  );
}

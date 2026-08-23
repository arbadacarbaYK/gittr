"use client";

import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from "react";

import { ReadmeMarkdownImage } from "@/components/repo/ReadmeMarkdownImage";
import { markdownRehypePlugins } from "@/lib/security/markdown-rehype-plugins";
import { MarkdownCode } from "@/lib/utils/markdown-code";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Only truly huge READMEs need a click — normal forge READMEs (~5–20KB) must
 * auto-format after idle. A 4KB gate made real READMEs look like broken stubs
 * (“Show formatted README” + first 1200 raw chars).
 */
const MANUAL_MARKDOWN_MIN_CHARS = 48_000;

/**
 * Isolate README markdown parse from Code-page tree/date re-renders.
 * Idle-gated mount keeps header/tabs usable; chrome pointerdown pauses auto
 * parse so navigation is not starved.
 */
export const RepoFolderReadmeMarkdown = memo(function RepoFolderReadmeMarkdown({
  markdown,
  headingComponents,
  proseCodeSafeComponents,
  markdownAnchor,
  branch,
  forgeSourceUrl,
  cloneUrls,
  ownerPubkey,
  repoName,
  entity,
}: {
  markdown: string;
  headingComponents: Record<string, unknown>;
  proseCodeSafeComponents: Record<string, unknown>;
  markdownAnchor: unknown;
  branch: string;
  forgeSourceUrl: string | null;
  cloneUrls: string[] | null;
  ownerPubkey: string | null;
  repoName: string;
  entity: string;
}) {
  const deferred = useDeferredValue(markdown);
  const needsManual = (deferred?.length || 0) > MANUAL_MARKDOWN_MIN_CHARS;
  const [allowMount, setAllowMount] = useState(false);
  const [userRequested, setUserRequested] = useState(false);
  const [pausedForChrome, setPausedForChrome] = useState(false);

  useEffect(() => {
    setAllowMount(false);
    setUserRequested(false);
    setPausedForChrome(false);
  }, [deferred]);

  useEffect(() => {
    if (!deferred || needsManual || userRequested || pausedForChrome) return;
    let cancelled = false;
    const enable = () => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        startTransition(() => setAllowMount(true));
      });
    };
    const onChromePointer = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-repo-chrome], header")) {
        cancelled = true;
        setAllowMount(false);
        setPausedForChrome(true);
      }
    };
    document.addEventListener("pointerdown", onChromePointer, true);

    const w = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (
          cb: IdleRequestCallback,
          opts?: IdleRequestOptions
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      };
    const idleTimeoutMs = deferred.length > 16_000 ? 3500 : 2000;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(enable, { timeout: idleTimeoutMs });
      return () => {
        cancelled = true;
        document.removeEventListener("pointerdown", onChromePointer, true);
        w.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(enable, Math.min(idleTimeoutMs, 1000));
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", onChromePointer, true);
      window.clearTimeout(t);
    };
  }, [deferred, needsManual, userRequested, pausedForChrome]);

  useEffect(() => {
    if (!userRequested || !deferred) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      startTransition(() => {
        setPausedForChrome(false);
        setAllowMount(true);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [userRequested, deferred]);

  if (!deferred) return null;

  if (!allowMount) {
    if (needsManual && !userRequested) {
      return (
        <div className="space-y-3 py-2">
          <button
            type="button"
            className="text-sm text-[var(--color-link)] hover:underline"
            onClick={() => setUserRequested(true)}
          >
            Show formatted README
          </button>
          <pre className="whitespace-pre-wrap break-words text-sm text-muted-foreground max-h-48 overflow-auto border border-[var(--color-border)] rounded p-3">
            {deferred.slice(0, 1200)}
            {deferred.length > 1200 ? "\n…" : ""}
          </pre>
        </div>
      );
    }
    if (pausedForChrome && !userRequested) {
      return (
        <div className="py-2">
          <button
            type="button"
            className="text-sm text-[var(--color-link)] hover:underline"
            onClick={() => setUserRequested(true)}
          >
            Show formatted README
          </button>
        </div>
      );
    }
    return (
      <p className="text-sm text-muted-foreground py-2">Preparing README…</p>
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={markdownRehypePlugins}
      components={
        {
          ...headingComponents,
          ...proseCodeSafeComponents,
          img: ({ ...props }: { src?: string; alt?: string }) => {
            return (
              <div className="my-4 overflow-x-auto">
                <ReadmeMarkdownImage
                  src={props.src || ""}
                  alt={props.alt || ""}
                  branch={branch}
                  forgeSourceUrl={forgeSourceUrl}
                  cloneUrls={cloneUrls}
                  ownerPubkey={ownerPubkey}
                  repoName={repoName}
                  entity={entity}
                />
              </div>
            );
          },
          a: markdownAnchor as any,
          code: MarkdownCode,
        } as any
      }
    >
      {deferred}
    </ReactMarkdown>
  );
});

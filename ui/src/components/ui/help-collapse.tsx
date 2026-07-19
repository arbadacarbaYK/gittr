"use client";

import { type ReactNode } from "react";

import { ChevronDown } from "lucide-react";

type HelpSectionProps = {
  id?: string;
  title: ReactNode;
  children: ReactNode;
  /** Keep short overviews open; long docs stay closed by default. */
  defaultOpen?: boolean;
  className?: string;
};

/**
 * Top-level help accordion. Closed by default so /help is scannable.
 * Deep links (#id) open matching details via openHelpHashTargets().
 */
export function HelpSection({
  id,
  title,
  children,
  defaultOpen = false,
  className = "",
}: HelpSectionProps) {
  return (
    <details
      id={id}
      className={`group help-section border border-[#383B42] rounded-lg bg-[#171B21] mb-4 scroll-mt-24 open:mb-6 ${className}`}
      ref={(node) => {
        if (node && defaultOpen) node.open = true;
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-white select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-xl font-semibold leading-tight md:text-2xl">
          {title}
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-gray-500 transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-3 border-t border-[#383B42] px-5 pb-5 pt-4 text-gray-300">
        {children}
      </div>
    </details>
  );
}

type HelpTopicProps = {
  id?: string;
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
};

/** Nested topic inside a HelpSection — also collapsed by default. */
export function HelpTopic({
  id,
  title,
  children,
  defaultOpen = false,
}: HelpTopicProps) {
  return (
    <details
      id={id}
      className="group/topic help-topic rounded-lg border border-[#383B42]/70 bg-[#0f1318]/80 scroll-mt-24"
      ref={(node) => {
        if (node && defaultOpen) node.open = true;
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-white select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-base font-semibold leading-snug md:text-lg">
          {title}
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 group-open/topic:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 border-t border-[#383B42]/50 px-3.5 pb-3.5 pt-3 text-sm text-gray-300 md:text-[15px]">
        {children}
      </div>
    </details>
  );
}

type HelpSubTopicProps = {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
};

/** Third level: options, diagrams, error lists inside a topic. */
export function HelpSubTopic({
  title,
  children,
  defaultOpen = false,
}: HelpSubTopicProps) {
  return (
    <details
      className="group/sub help-subtopic rounded-md border border-[#383B42]/50 bg-[#12161c] mt-2"
      ref={(node) => {
        if (node && defaultOpen) node.open = true;
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-gray-200 select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 leading-snug">{title}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-200 group-open/sub:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 border-t border-[#383B42]/40 px-3 pb-3 pt-2 text-sm text-gray-300">
        {children}
      </div>
    </details>
  );
}

/** Open every &lt;details&gt; ancestor of the hash target, then scroll. */
export function openHelpHashTargets(hashId: string): void {
  if (!hashId || typeof document === "undefined") return;
  const el = document.getElementById(hashId);
  if (!el) return;
  let node: HTMLElement | null = el;
  while (node) {
    if (node.tagName === "DETAILS") {
      (node as HTMLDetailsElement).open = true;
    }
    node = node.parentElement;
  }
  window.setTimeout(() => {
    document.getElementById(hashId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 80);
}

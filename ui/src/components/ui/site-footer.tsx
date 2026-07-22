"use client";

import { ZapButton } from "@/components/ui/zap-button";

import Link from "next/link";

/**
 * Site-wide footer: donation + legal disclaimer link.
 */
export function SiteFooter() {
  return (
    <footer className="mt-12 mb-6 flex flex-col items-center justify-center gap-4 border-t border-[var(--color-border,#383B42)] pt-8">
      <p className="text-center text-sm text-gray-400">
        Made by Bitcoiners with{" "}
        <span
          className="inline-block"
          style={{ color: "var(--color-accent-primary)" }}
        >
          💜
        </span>
      </p>
      <div className="flex items-center justify-center">
        <ZapButton
          recipient="npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s"
          amount={21}
          comment="Donation to gittr.space"
          recipientMetadata={{
            lud16: "arbadacarba@btip.nl",
            lnurl:
              "LNURL1DP68GURN8GHJ7CN5D9CZUMNV9UH8WETVDSKKKMN0WAHZ7MRWW4EXCUP0X9UXGDEEXQ6XVVM9XUMXGDFCXY6NQS43TRV",
          }}
          variant="outline"
          size="sm"
          className="text-sm"
          label="Donate to this project"
        />
      </div>
      <nav
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-400"
        aria-label="Legal"
      >
        <Link
          href="/legal"
          className="hover:underline theme-link"
          style={{ color: "var(--color-accent-primary)" }}
        >
          Legal
        </Link>
        <span className="text-gray-600" aria-hidden>
          ·
        </span>
        <Link href="/help" className="hover:underline">
          Help
        </Link>
      </nav>
    </footer>
  );
}

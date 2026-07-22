import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal",
  description: "Disclaimer and contact for gittr.space",
};

const CONTACT_EMAIL = "info@gittr.space";

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-2xl py-10 px-2">
      <h1 className="text-2xl font-bold mb-6 theme-text-primary">Legal</h1>

      <section id="disclaimer" className="mb-10 scroll-mt-24">
        <h2 className="text-lg font-semibold mb-3 theme-text-primary">
          Disclaimer
        </h2>
        <p className="text-gray-300 leading-relaxed mb-4">
          <strong className="theme-text-primary">gittr</strong> is a free,
          non-commercial client for the open{" "}
          <strong className="theme-text-primary">Nostr</strong> protocol.
          Repository announcements, pull requests, issues, and similar entries
          live on Nostr (and locally in your browser) — not as “our” content.
        </p>
        <p className="text-gray-300 leading-relaxed">
          The app only shows what the protocol and your local environment
          provide. We cannot be held accountable for third-party content visible
          through Nostr. Authors sign their own events; this is not an editorial
          service.
        </p>
      </section>

      <section id="contact" className="mb-10 scroll-mt-24">
        <h2 className="text-lg font-semibold mb-3 theme-text-primary">
          Contact / blacklist
        </h2>
        <p className="text-gray-300 leading-relaxed">
          For blacklist requests in this client (e.g. compromised accounts):{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="theme-link font-mono"
            style={{ color: "var(--color-accent-primary)" }}
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <section id="privacy" className="mb-10 scroll-mt-24">
        <h2 className="text-lg font-semibold mb-3 theme-text-primary">
          Privacy
        </h2>
        <p className="text-gray-300 leading-relaxed">
          Preferences and caches stay in your browser. What is published on
          Nostr is public and outside our control. Brief technical web logs may
          exist for the website.
        </p>
      </section>

      <p className="text-xs text-gray-600 mt-12">Updated: July 2026</p>
    </main>
  );
}

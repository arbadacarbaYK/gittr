import {
  NOSTR_GIT_DESCRIPTION,
  NOSTR_GIT_FAQ,
  SITE_DESCRIPTION_DEFAULT,
} from "./site-copy";

export type JsonLdRecord = Record<string, unknown>;

export function websiteJsonLd(siteUrl: string): JsonLdRecord {
  const origin = siteUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "gittr",
    url: origin,
    description: SITE_DESCRIPTION_DEFAULT,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}/explore?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function softwareApplicationJsonLd(siteUrl: string): JsonLdRecord {
  const origin = siteUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "gittr",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, Android",
    url: origin,
    description: SITE_DESCRIPTION_DEFAULT,
    featureList: [
      "Nostr git hosting (NIP-34)",
      "Issues and pull requests as signed events",
      "gittr Pages",
      "Nostr apps catalog (NIP-82)",
      "Lightning bounties",
    ],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
}

export function softwareSourceCodeJsonLd(opts: {
  name: string;
  description: string;
  url: string;
}): JsonLdRecord {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    codeRepository: opts.url,
    codingLanguage: "Git",
  };
}

export function nostrGitArticleJsonLd(siteUrl: string): JsonLdRecord {
  const origin = siteUrl.replace(/\/$/, "");
  const url = `${origin}/nostr-git`;
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Why Nostr git",
    name: "Why Nostr git",
    description: NOSTR_GIT_DESCRIPTION,
    url,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "gittr", url: origin },
    publisher: { "@type": "Organization", name: "gittr", url: origin },
  };
}

export function nostrGitFaqJsonLd(): JsonLdRecord {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: NOSTR_GIT_FAQ.map((item) => ({
      "@type": "Question",
      name: item.name,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.text,
      },
    })),
  };
}

export function softwareAppJsonLd(opts: {
  name: string;
  description: string;
  url: string;
  identifier: string;
}): JsonLdRecord {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    identifier: opts.identifier,
    applicationCategory: "MobileApplication",
    operatingSystem: "Android, Web",
  };
}

/** Safe inner HTML for a JSON-LD script tag. */
export function jsonLdScriptHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

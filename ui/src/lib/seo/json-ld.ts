import { SITE_DESCRIPTION_DEFAULT } from "./site-copy";

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
    headline: "What is Nostr git?",
    name: "Nostr git hosting on gittr",
    description:
      "Nostr git (NIP-34) publishes repository announcements, issues, and pull requests as signed events. gittr is web hosting for that protocol.",
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
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Nostr git?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nostr git is git collaboration over Nostr. Repository names, issues, and pull requests are signed events (NIP-34). Git objects still live on clone hosts such as git.gittr.space or other GRASP servers.",
        },
      },
      {
        "@type": "Question",
        name: "What is gittr?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "gittr is Nostr git hosting: a web forge to mirror repositories, run issues and PRs, publish Pages, browse Nostr apps, and fund work with Lightning bounties.",
        },
      },
      {
        "@type": "Question",
        name: "How do I clone a gittr repository?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Use the clone URL on the repo page — typically SSH or HTTPS to git.gittr.space — or any other clone host listed on the Nostr announcement.",
        },
      },
    ],
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

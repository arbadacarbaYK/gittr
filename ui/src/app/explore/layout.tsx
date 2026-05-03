import type { ReactNode } from "react";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Repos",
  description:
    "Browse public git repositories published on Nostr (same data as the Repos link in the header).",
};

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return children;
}

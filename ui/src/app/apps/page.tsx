import type { Metadata } from "next";

import { AppsDirectoryClient } from "./AppsDirectoryClient";

export const metadata: Metadata = {
  title: "Apps",
  description:
    "NIP-82 software on Nostr — discover and install APKs from the same catalog family as Zapstore.",
};

export default function AppsPage() {
  return <AppsDirectoryClient />;
}

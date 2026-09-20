import { type ReactNode } from "react";

import { buildNoindexPageMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexPageMetadata({
  path: "/repositories",
  title: "Your repositories",
  description:
    "Your Nostr git repositories on gittr — signed-in list, not a public catalog.",
});

export default function RepositoriesLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

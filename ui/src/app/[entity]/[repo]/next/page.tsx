"use client";

import { useEffect } from "react";

import { useParams } from "next/navigation";

/**
 * Legacy preview URL — hard-redirect to the real Code page (next UI is default).
 * Preserves query string from the current location.
 */
export default function RepoNextRedirectPage() {
  const params = useParams();

  useEffect(() => {
    const entity = decodeURIComponent(String(params?.entity || ""));
    const repo = decodeURIComponent(String(params?.repo || ""));
    if (!entity || !repo) return;
    const q =
      typeof window !== "undefined" ? window.location.search || "" : "";
    window.location.replace(`/${entity}/${repo}${q}`);
  }, [params?.entity, params?.repo]);

  return (
    <p className="text-sm text-[var(--color-text-secondary)] py-6">
      Redirecting to Code…
    </p>
  );
}

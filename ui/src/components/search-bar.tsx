"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { usePathname, useSearchParams } from "next/navigation";

function SearchBarInner({ className }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  /** Skip URL→input sync while the user is editing. */
  const suppressSyncRef = useRef(false);

  const urlQ = searchParams?.get("q")?.trim() || "";
  const urlUser = searchParams?.get("user")?.trim() || "";
  const exploreQuery =
    pathname === "/explore"
      ? urlQ ||
        (urlUser
          ? urlUser.startsWith("npub")
            ? urlUser
            : `@${urlUser}`
          : "")
      : "";

  useEffect(() => {
    if (suppressSyncRef.current) return;
    if (ref.current && exploreQuery !== ref.current.value) {
      ref.current.value = exploreQuery;
    }
  }, [exploreQuery]);

  const goExplore = useCallback((params: { q?: string; user?: string }) => {
    const sp = new URLSearchParams();
    if (params.user) sp.set("user", params.user);
    if (params.q) sp.set("q", params.q);
    const qs = sp.toString();
    const href = qs ? `/explore?${qs}` : "/explore";
    // Hard nav — soft router.push/replace was silently no-op from the header
    // SearchBar on some pages; seed API makes explore remount cheap.
    window.location.assign(href);
  }, []);

  const clearExploreFilters = useCallback(() => {
    if (pathname !== "/explore") return;
    suppressSyncRef.current = true;
    if (ref.current) ref.current.value = "";
    window.location.assign("/explore");
  }, [pathname]);

  const submitQuery = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) {
        clearExploreFilters();
        return;
      }

      const npubMatch = q.match(/^(npub1[0-9a-z]+)$/i);
      if (npubMatch) {
        goExplore({ user: npubMatch[1] });
        return;
      }
      if (q.startsWith("@") && q.length > 1) {
        goExplore({ user: q.slice(1) });
        return;
      }

      goExplore({ q });
    },
    [clearExploreFilters, goExplore]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitQuery(ref.current?.value || "");
    },
    [submitQuery]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape" && pathname === "/explore") {
        e.preventDefault();
        clearExploreFilters();
      }
      // Enter is handled by the wrapping <form onSubmit>.
    },
    [clearExploreFilters, pathname]
  );

  // Live-clear while deleting on explore: empty box drops ?q= / ?user=.
  const handleChange = useCallback(() => {
    if (pathname !== "/explore") return;
    const q = ref.current?.value?.trim() || "";
    if (!q && (urlQ || urlUser)) {
      clearExploreFilters();
    }
  }, [clearExploreFilters, pathname, urlQ, urlUser]);

  return (
    <form onSubmit={handleSubmit} className="w-full" role="search">
      <Input
        ref={ref}
        className={cn(
          "w-full bg-[#0E1116] transition-all ease-in-out",
          className
        )}
        type="search"
        name="q"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Search or jump to…"
        defaultValue={exploreQuery}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onFocus={() => {
          suppressSyncRef.current = true;
        }}
        onBlur={() => {
          window.setTimeout(() => {
            suppressSyncRef.current = false;
          }, 0);
        }}
      />
    </form>
  );
}

export default function SearchBar({ className }: { className?: string }) {
  return (
    <Suspense
      fallback={
        <Input
          className={cn(
            "w-full bg-[#0E1116] transition-all ease-in-out",
            className
          )}
          type="search"
          placeholder="Search or jump to…"
        />
      }
    >
      <SearchBarInner className={className} />
    </Suspense>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  authorLabelForFilter,
  type ListSearchKind,
  type ListSearchableItem,
  upsertListSearchQualifier,
  upsertListSearchSort,
} from "@/lib/utils/issue-pr-list-search";

import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";

type MenuKey = "author" | "label" | "assignee" | "sort" | null;

function FilterMenu({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full z-30 mt-1 min-w-[12rem] max-h-64 overflow-y-auto rounded-md border border-lightgray bg-[#0E1116] py-1 shadow-lg">
      {children}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="block w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-dark"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Author / label / assignee / sort menus for repo Issues and Pulls tabs. */
export default function IssuesPrFilterMenuRow({
  search,
  onSearchChange,
  kind,
  items,
  authorMetadata,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  kind: ListSearchKind;
  items: ListSearchableItem[];
  authorMetadata: Record<
    string,
    { name?: string; display_name?: string; nip05?: string }
  >;
}) {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const apply = (fn: () => void) => {
    fn();
    setOpenMenu(null);
  };

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      const a = it.author;
      if (!a) continue;
      if (!map.has(a)) {
        map.set(a, authorLabelForFilter(a, authorMetadata));
      }
    }
    return [...map.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" })
    );
  }, [items, authorMetadata]);

  const labels = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of it.tags || []) {
        if (t?.trim()) set.add(t.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const assignees = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      for (const a of it.assignees || []) {
        if (!a) continue;
        if (!map.has(a)) {
          map.set(a, authorLabelForFilter(a, authorMetadata));
        }
      }
    }
    return [...map.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" })
    );
  }, [items, authorMetadata]);

  const menuBtn = (key: MenuKey, label: string) => (
    <button
      type="button"
      className={clsx(
        "relative flex text-zinc-400 hover:text-zinc-200 items-center",
        openMenu === key && "text-zinc-50"
      )}
      onClick={() => setOpenMenu((m) => (m === key ? null : key))}
      aria-expanded={openMenu === key}
    >
      {label} <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-400"
    >
        <div className="relative">
          {menuBtn("author", "Author")}
          <FilterMenu open={openMenu === "author"}>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(
                    upsertListSearchQualifier(search, "author", null, kind)
                  )
                )
              }
            >
              Any author
            </MenuItem>
            {authors.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">No authors</p>
            ) : (
              authors.map(([pubkey, label]) => (
                <MenuItem
                  key={pubkey}
                  onClick={() =>
                    apply(() =>
                      onSearchChange(
                        upsertListSearchQualifier(search, "author", pubkey, kind)
                      )
                    )
                  }
                >
                  {label}
                </MenuItem>
              ))
            )}
          </FilterMenu>
        </div>

        <div className="relative hidden md:block">
          {menuBtn("label", "Label")}
          <FilterMenu open={openMenu === "label"}>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(
                    upsertListSearchQualifier(search, "label", null, kind)
                  )
                )
              }
            >
              Any label
            </MenuItem>
            {labels.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">No labels</p>
            ) : (
              labels.map((label) => (
                <MenuItem
                  key={label}
                  onClick={() =>
                    apply(() =>
                      onSearchChange(
                        upsertListSearchQualifier(search, "label", label, kind)
                      )
                    )
                  }
                >
                  {label}
                </MenuItem>
              ))
            )}
          </FilterMenu>
        </div>

        <div className="relative">
          {menuBtn("assignee", "Assignee")}
          <FilterMenu open={openMenu === "assignee"}>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(
                    upsertListSearchQualifier(search, "assignee", null, kind)
                  )
                )
              }
            >
              Any assignee
            </MenuItem>
            {assignees.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">No assignees</p>
            ) : (
              assignees.map(([pubkey, label]) => (
                <MenuItem
                  key={pubkey}
                  onClick={() =>
                    apply(() =>
                      onSearchChange(
                        upsertListSearchQualifier(
                          search,
                          "assignee",
                          pubkey,
                          kind
                        )
                      )
                    )
                  }
                >
                  {label}
                </MenuItem>
              ))
            )}
          </FilterMenu>
        </div>

        <div className="relative">
          {menuBtn("sort", "Sort")}
          <FilterMenu open={openMenu === "sort"}>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(upsertListSearchSort(search, "newest", kind))
                )
              }
            >
              Newest
            </MenuItem>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(upsertListSearchSort(search, "oldest", kind))
                )
              }
            >
              Oldest
            </MenuItem>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(upsertListSearchSort(search, "updated", kind))
                )
              }
            >
              Recently updated
            </MenuItem>
            <MenuItem
              onClick={() =>
                apply(() =>
                  onSearchChange(upsertListSearchSort(search, null, kind))
                )
              }
            >
              Default sort
            </MenuItem>
          </FilterMenu>
        </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import {
  type AggregateListGroup,
  type AggregateListSort,
  type AggregateListSource,
  groupMenuLabel,
  sortMenuLabel,
  sourceMenuLabel,
} from "@/lib/utils/global-issues-pr-list";

import { ChevronDown } from "lucide-react";

type MenuKey = "source" | "group" | "sort" | null;

function FilterMenu({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] max-h-64 overflow-y-auto rounded-md border border-lightgray bg-[#0E1116] py-1 shadow-lg">
      {children}
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-dark ${
        active ? "text-purple-300" : "text-zinc-200"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Working Source / Group / Sort menus for global /issues and /pulls.
 * (Replaces the old decorative Visibility / Organization / Sort spans.)
 */
export default function GlobalIssuesPrListControls({
  source,
  group,
  sort,
  onSourceChange,
  onGroupChange,
  onSortChange,
}: {
  source: AggregateListSource;
  group: AggregateListGroup;
  sort: AggregateListSort;
  onSourceChange: (v: AggregateListSource) => void;
  onGroupChange: (v: AggregateListGroup) => void;
  onSortChange: (v: AggregateListSort) => void;
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

  const toggle = (key: MenuKey) =>
    setOpenMenu((cur) => (cur === key ? null : key));

  return (
    <div
      ref={rootRef}
      className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-gray-400 lg:mt-0"
    >
      <div className="relative">
        <button
          type="button"
          className="flex items-center text-zinc-400 hover:text-zinc-200"
          aria-expanded={openMenu === "source"}
          onClick={() => toggle("source")}
        >
          {sourceMenuLabel(source)}
          <ChevronDown className="h-4 w-4 ml-1" />
        </button>
        <FilterMenu open={openMenu === "source"}>
          <MenuItem
            active={source === "all"}
            onClick={() => apply(() => onSourceChange("all"))}
          >
            All repos
          </MenuItem>
          <MenuItem
            active={source === "originals"}
            onClick={() => apply(() => onSourceChange("originals"))}
          >
            Hide forks
          </MenuItem>
          <MenuItem
            active={source === "forks"}
            onClick={() => apply(() => onSourceChange("forks"))}
          >
            Forks only
          </MenuItem>
        </FilterMenu>
      </div>

      <div className="relative">
        <button
          type="button"
          className="flex items-center text-zinc-400 hover:text-zinc-200"
          aria-expanded={openMenu === "group"}
          onClick={() => toggle("group")}
        >
          {groupMenuLabel(group)}
          <ChevronDown className="h-4 w-4 ml-1" />
        </button>
        <FilterMenu open={openMenu === "group"}>
          <MenuItem
            active={group === "repo"}
            onClick={() => apply(() => onGroupChange("repo"))}
          >
            Group by repository
          </MenuItem>
          <MenuItem
            active={group === "flat"}
            onClick={() => apply(() => onGroupChange("flat"))}
          >
            Flat list
          </MenuItem>
        </FilterMenu>
      </div>

      <div className="relative">
        <button
          type="button"
          className="flex items-center text-zinc-400 hover:text-zinc-200"
          aria-expanded={openMenu === "sort"}
          onClick={() => toggle("sort")}
        >
          {sortMenuLabel(sort)}
          <ChevronDown className="h-4 w-4 ml-1" />
        </button>
        <FilterMenu open={openMenu === "sort"}>
          <MenuItem
            active={sort === "updated"}
            onClick={() => apply(() => onSortChange("updated"))}
          >
            Recently updated
          </MenuItem>
          <MenuItem
            active={sort === "newest"}
            onClick={() => apply(() => onSortChange("newest"))}
          >
            Newest
          </MenuItem>
          <MenuItem
            active={sort === "oldest"}
            onClick={() => apply(() => onSortChange("oldest"))}
          >
            Oldest
          </MenuItem>
        </FilterMenu>
      </div>
    </div>
  );
}

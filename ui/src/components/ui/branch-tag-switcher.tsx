"use client";

import { useState } from "react";
import { GitBranch, Tag, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

interface BranchTagSwitcherProps {
  branches: string[];
  tags: string[];
  selectedBranch: string;
  selectedTag?: string;
  onBranchSelect: (branch: string) => void;
  onTagSelect?: (tag: string) => void;
  onCreateBranch: (name: string) => void;
  defaultBranch?: string;
}

export function BranchTagSwitcher({
  branches,
  tags,
  selectedBranch,
  selectedTag,
  onBranchSelect,
  onTagSelect,
  onCreateBranch,
  defaultBranch = "main",
}: BranchTagSwitcherProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  // Normalize branches and tags to strings
  const normalizedBranches = branches.map(b => String(b || "")).filter(Boolean);
  const normalizedTags = tags.map(t => {
    if (typeof t === "string") return t;
    if (typeof t === "object" && t !== null) {
      const obj = t as { name?: string; tag?: string; [key: string]: any };
      return obj.name || obj.tag || String(t);
    }
    return String(t);
  }).filter(Boolean);
  
  const filteredBranches = normalizedBranches.filter(b =>
    b.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredTags = normalizedTags.filter(t =>
    t.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateBranch = () => {
    if (newBranchName.trim()) {
      onCreateBranch(newBranchName.trim());
      setNewBranchName("");
      setShowCreateBranch(false);
      setSearchQuery("");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 !border-[#383B42] bg-[#22262C] text-xs"
          variant="outline"
        >
          <GitBranch className="mr-2 h-4 w-4" />
          {selectedBranch}
          {selectedBranch === defaultBranch && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-purple-900/30 text-purple-400 rounded">
              default
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        {/* Search */}
        <div className="p-2 border-b border-gray-700">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter branches/tags..."
              className="pl-8 h-8 text-sm bg-gray-800 border-gray-600"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                }
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Branches Section */}
        <div className="max-h-60 overflow-y-auto">
          <div className="px-2 py-1.5 text-xs font-semibold text-gray-400 flex items-center gap-2">
            <GitBranch className="h-3 w-3" />
            Branches ({filteredBranches.length})
          </div>
          {filteredBranches.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-500 text-center">
              No branches found
            </div>
          ) : (
            filteredBranches.map((branch) => (
              <DropdownMenuItem
                key={branch}
                onClick={() => {
                  onBranchSelect(branch);
                  setSearchQuery("");
                }}
                className={`cursor-pointer ${
                  branch === selectedBranch ? "bg-purple-900/20" : ""
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3 w-3 text-gray-400" />
                    <span>{branch}</span>
                    {branch === defaultBranch && (
                      <span className="text-[10px] text-purple-400">default</span>
                    )}
                  </div>
                  {branch === selectedBranch && (
                    <span className="text-xs text-purple-400">✓</span>
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}

          {/* Create Branch */}
          {showCreateBranch ? (
            <div className="px-2 py-2 border-t border-gray-700">
              <div className="flex items-center gap-2">
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Branch name..."
                  className="h-7 text-sm bg-gray-800 border-gray-600"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateBranch();
                    } else if (e.key === "Escape") {
                      setShowCreateBranch(false);
                      setNewBranchName("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleCreateBranch}
                  className="h-7 px-2 bg-purple-600 hover:bg-purple-700"
                >
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowCreateBranch(false);
                    setNewBranchName("");
                  }}
                  className="h-7 px-2"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <DropdownMenuItem
              onClick={() => setShowCreateBranch(true)}
              className="cursor-pointer text-purple-400 hover:text-purple-300"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create new branch
            </DropdownMenuItem>
          )}

          {/* Tags Section */}
          {tags.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-semibold text-gray-400 flex items-center gap-2">
                <Tag className="h-3 w-3" />
                Tags ({filteredTags.length})
              </div>
              {filteredTags.length === 0 ? (
                <div className="px-2 py-4 text-xs text-gray-500 text-center">
                  No tags found
                </div>
              ) : (
                filteredTags.slice(0, 10).map((tag) => (
                  <DropdownMenuItem
                    key={tag}
                    onClick={() => {
                      onTagSelect?.(tag);
                      setSearchQuery("");
                    }}
                    className={`cursor-pointer ${
                      tag === selectedTag ? "bg-purple-900/20" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3 w-3 text-gray-400" />
                        <span>{tag}</span>
                      </div>
                      {tag === selectedTag && (
                        <span className="text-xs text-purple-400">✓</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))
              )}
              {filteredTags.length > 10 && (
                <div className="px-2 py-1 text-xs text-gray-500 text-center">
                  ...and {filteredTags.length - 10} more
                </div>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


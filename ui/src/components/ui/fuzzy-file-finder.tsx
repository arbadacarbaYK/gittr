"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  Code,
  File,
  FileJson,
  FileText,
  FileType,
  Folder,
  Image,
  Search,
} from "lucide-react";

interface FileItem {
  type: "file" | "dir";
  path: string;
  size?: number;
}

interface FuzzyFileFinderProps {
  files: FileItem[];
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (path: string) => void;
  currentPath?: string;
}

// Fuzzy matching algorithm - scores files based on query match
function fuzzyScore(path: string, query: string | undefined): number {
  if (!query || !query.trim()) return 0;
  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  // Exact match gets highest score
  if (lowerPath === lowerQuery) return 1000;

  // Starts with query
  if (lowerPath.startsWith(lowerQuery)) return 500;

  // Contains query
  if (lowerPath.includes(lowerQuery)) return 100;

  // Fuzzy match: check if all query characters appear in order
  let pathIndex = 0;
  let score = 0;
  const queryLength = lowerQuery.length;
  for (let i = 0; i < queryLength; i++) {
    const char = lowerQuery[i] || "";
    const foundIndex = lowerPath.indexOf(char, pathIndex);
    if (foundIndex === -1) return 0; // Not a match
    // Prefer matches that are close together
    score += foundIndex - pathIndex === 0 ? 10 : 5;
    pathIndex = foundIndex + 1;
  }

  // Bonus for filename match vs path match
  const fileName = path.split("/").pop() || "";
  if (fileName.toLowerCase().includes(lowerQuery)) score += 20;

  return score;
}

// Get file icon based on extension
function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const fileName = path.split("/").pop()?.toLowerCase() || "";

  if (fileName === "readme.md" || fileName.endsWith(".md")) {
    return FileText;
  }

  const codeExts = [
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "cpp",
    "c",
    "h",
    "hpp",
  ];
  if (codeExts.includes(ext)) {
    return Code;
  }

  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
  if (imageExts.includes(ext)) {
    return Image;
  }

  if (
    ext === "json" ||
    fileName === "package.json" ||
    fileName === "tsconfig.json"
  ) {
    return FileJson;
  }

  return File;
}

// Highlight matching text in path
function highlightMatch(path: string, query: string): JSX.Element {
  if (!query) return <span>{path}</span>;

  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  // Find all matches (case-insensitive)
  let index = lowerPath.indexOf(lowerQuery, lastIndex);
  while (index !== -1) {
    // Add text before match
    if (index > lastIndex) {
      parts.push(path.substring(lastIndex, index));
    }
    // Add highlighted match
    parts.push(
      <span
        key={index}
        className="bg-yellow-500/30 text-yellow-200 font-semibold"
      >
        {path.substring(index, index + query.length)}
      </span>
    );
    lastIndex = index + query.length;
    index = lowerPath.indexOf(lowerQuery, lastIndex);
  }

  // Add remaining text
  if (lastIndex < path.length) {
    parts.push(path.substring(lastIndex));
  }

  return <>{parts}</>;
}

export function FuzzyFileFinder({
  files,
  isOpen,
  onClose,
  onSelectFile,
  currentPath = "",
}: FuzzyFileFinderProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Get all file paths (filter out directories or include them as clickable)
  const allFiles = useMemo(() => {
    return files.filter((f) => f.type === "file").map((f) => f.path);
  }, [files]);

  // Load recent files from localStorage
  const recentFiles = useMemo(() => {
    if (typeof window === "undefined") return [] as string[];
    try {
      const stored = localStorage.getItem(`gittr_recent_files_${currentPath}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed.slice(0, 10) : []; // Last 10 files
      }
    } catch {}
    return [] as string[];
  }, [currentPath]);

  // Filter and score files based on query
  const filteredFiles = useMemo(() => {
    if (!query.trim()) {
      // Show recent files when query is empty
      return recentFiles
        .map((path) => ({ path, score: 999 }))
        .filter((item) => allFiles.includes(item.path))
        .slice(0, 20);
    }

    return allFiles
      .map((path: string) => ({
        path,
        score: fuzzyScore(path, query),
      }))
      .filter((item: { path: string; score: number }) => item.score > 0)
      .sort(
        (
          a: { path: string; score: number },
          b: { path: string; score: number }
        ) => b.score - a.score
      )
      .slice(0, 50);
  }, [query, allFiles, recentFiles]);

  // Reset selected index when query or results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filteredFiles.length]);

  // Save file to recent files
  const saveToRecent = useCallback(
    (path: string) => {
      if (typeof window === "undefined") return;
      try {
        const key = `gittr_recent_files_${currentPath}`;
        const stored = localStorage.getItem(key);
        const recent = stored ? JSON.parse(stored) : [];
        const updated = recent.filter((p: string) => p !== path);
        updated.unshift(path); // Add to front
        localStorage.setItem(key, JSON.stringify(updated.slice(0, 20))); // Keep last 20
      } catch {}
    },
    [currentPath]
  );

  const handleSelectFile = useCallback(
    (path: string) => {
      saveToRecent(path);
      onSelectFile(path);
      onClose();
      setQuery("");
    },
    [onSelectFile, onClose, saveToRecent]
  );

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredFiles.length - 1 ? prev + 1 : prev
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const selectedFile = filteredFiles[selectedIndex];
        if (selectedFile) {
          handleSelectFile(selectedFile.path);
        } else if (filteredFiles.length === 1 && filteredFiles[0]) {
          // If only one result, select it
          handleSelectFile(filteredFiles[0].path);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredFiles, selectedIndex, handleSelectFile, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && filteredFiles.length > 0) {
      const selectedElement = resultsRef.current.children[
        selectedIndex
      ] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex, filteredFiles.length]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-[#171B21] border border-[#383B42] rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#383B42]">
          <Search className="h-5 w-5 text-gray-400" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Type to search files... (⌘/Ctrl+P to open)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-500"
            autoFocus
          />
          <kbd className="hidden md:flex items-center gap-1 px-2 py-1 text-xs font-mono text-gray-400 border border-[#383B42] rounded">
            <span>⌘</span>
            <span>P</span>
          </kbd>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[60vh] overflow-y-auto">
          {filteredFiles.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400">
              {query.trim()
                ? "No files found"
                : "Start typing to search files..."}
            </div>
          ) : (
            <ul className="py-2">
              {filteredFiles.map(
                (item: { path: string; score: number }, index: number) => {
                  const Icon = getFileIcon(item.path);
                  const fileName = item.path.split("/").pop() || "";
                  const dirPath = item.path.split("/").slice(0, -1).join("/");

                  return (
                    <li
                      key={item.path}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-white/5",
                        index === selectedIndex &&
                          "bg-purple-900/30 border-l-2 border-purple-500"
                      )}
                      onClick={() => handleSelectFile(item.path)}
                    >
                      <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">
                          {highlightMatch(fileName, query)}
                        </div>
                        {dirPath && (
                          <div className="text-xs text-gray-500 truncate">
                            {dirPath}
                          </div>
                        )}
                      </div>
                      {index < 10 && !query.trim() && (
                        <span className="text-xs text-gray-500">
                          {index + 1}
                        </span>
                      )}
                    </li>
                  );
                }
              )}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#383B42] text-xs text-gray-500 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
          <span>
            {filteredFiles.length}{" "}
            {filteredFiles.length === 1 ? "file" : "files"}
          </span>
        </div>
      </div>
    </div>
  );
}

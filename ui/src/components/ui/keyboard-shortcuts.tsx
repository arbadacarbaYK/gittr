"use client";

import { useState, useEffect } from "react";
import { X, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Shortcut {
  keys: string[];
  description: string;
  category: "navigation" | "editing" | "general";
}

const shortcuts: Shortcut[] = [
  // Navigation
  { keys: ["g", "h"], description: "Go to homepage", category: "navigation" },
  { keys: ["g", "c"], description: "Go to code view", category: "navigation" },
  { keys: ["g", "i"], description: "Go to issues", category: "navigation" },
  { keys: ["g", "p"], description: "Go to pull requests", category: "navigation" },
  { keys: ["g", "s"], description: "Go to settings", category: "navigation" },
  { keys: ["/"], description: "Focus search", category: "navigation" },
  { keys: ["esc"], description: "Close modal/dialog", category: "navigation" },
  
  // Editing
  { keys: ["e"], description: "Edit file (when on file view)", category: "editing" },
  { keys: ["b"], description: "Blame view (when on file view)", category: "editing" },
  { keys: ["r"], description: "Raw file view (when on file view)", category: "editing" },
  
  // General
  { keys: ["?"], description: "Show keyboard shortcuts", category: "general" },
  { keys: ["ctrl", "k"], description: "Command palette (coming soon)", category: "general" },
];

interface KeyboardShortcutsProps {
  onClose: () => void;
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const grouped = shortcuts.reduce((acc, shortcut) => {
    const category = shortcut.category || "Other";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category]!.push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  const formatKeys = (keys: string[]) => {
    return keys.map(key => {
      if (key === "ctrl") return "Ctrl";
      if (key === "alt") return "Alt";
      if (key === "shift") return "Shift";
      if (key === "esc") return "Esc";
      if (key === "/") return "/";
      if (key === "?") return "?";
      return key.toUpperCase();
    }).join(" + ");
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Keyboard className="h-6 w-6 text-purple-400" />
            <h2 className="text-2xl font-bold">Keyboard Shortcuts</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold mb-3 capitalize text-purple-300">
                {category}
              </h3>
              <div className="space-y-2">
                {items.map((shortcut, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded hover:bg-gray-800">
                    <span className="text-gray-300">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, kIdx) => (
                        <kbd
                          key={kIdx}
                          className="px-2 py-1 text-xs font-semibold bg-gray-800 border border-gray-600 rounded text-purple-300"
                        >
                          {formatKeys([key])}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700 text-sm text-gray-400">
          Press <kbd className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded">Esc</kbd> or click outside to close
        </div>
      </div>
    </div>
  );
}

export function useKeyboardShortcuts() {
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Show shortcuts with ?
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only if not typing in an input
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }

      // Navigation shortcuts (g + key)
      if (e.key === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
          // Wait for next key
          const handleNextKey = (e2: KeyboardEvent) => {
            if (e2.key === "h") {
              window.location.href = "/";
            } else if (e2.key === "c") {
              // Extract entity/repo from current URL
              const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
              if (match) {
                window.location.href = `/${match[1]}/${match[2]}`;
              }
            } else if (e2.key === "i") {
              const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
              if (match) {
                window.location.href = `/${match[1]}/${match[2]}/issues`;
              }
            } else if (e2.key === "p") {
              const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
              if (match) {
                window.location.href = `/${match[1]}/${match[2]}/pulls`;
              }
            } else if (e2.key === "s") {
              const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
              if (match) {
                window.location.href = `/${match[1]}/${match[2]}/settings`;
              }
            }
            window.removeEventListener("keydown", handleNextKey);
          };
          window.addEventListener("keydown", handleNextKey, { once: true });
        }
      }

      // Focus search with /
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
          e.preventDefault();
          const searchInput = document.querySelector('input[type="search"], input[placeholder*="Search"]') as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
          }
        }
      }

      // File view shortcuts
      const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)/);
      if (match) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
          if (e.key === "e" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const editButton = document.querySelector('button:has-text("Edit"), button[aria-label*="Edit"]') as HTMLButtonElement;
            if (editButton) {
              editButton.click();
            }
          } else if (e.key === "b" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const urlParams = new URLSearchParams(window.location.search);
            const file = urlParams.get("file");
            if (file) {
              window.location.href = `${window.location.pathname}/blame?file=${encodeURIComponent(file)}`;
            }
          } else if (e.key === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const urlParams = new URLSearchParams(window.location.search);
            const file = urlParams.get("file");
            if (file) {
              window.location.href = `${window.location.pathname}/raw?file=${encodeURIComponent(file)}`;
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { showShortcuts, setShowShortcuts };
}


"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { createCodeSnippetEvent, KIND_CODE_SNIPPET } from "@/lib/nostr/events";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { publishWithConfirmation } from "@/lib/nostr/publish-with-confirmation";
import { nip19 } from "nostr-tools";
import { Share2, X } from "lucide-react";

interface CodeViewerProps {
  content: string;
  filePath: string;
  entity: string;
  repo: string;
  branch?: string;
}

export function CodeViewer({ content, filePath, entity, repo, branch }: CodeViewerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedLines, setSelectedLines] = useState<{ start: number; end: number } | null>(null);
  const lastFileFromUrlRef = useRef<string>(""); // Track file from URL to detect changes
  const [showSnippetModal, setShowSnippetModal] = useState(false);
  const [snippetDescription, setSnippetDescription] = useState("");
  const [snippetPublishing, setSnippetPublishing] = useState(false);
  const [rangeMode, setRangeMode] = useState(false); // Two-click selection mode
  const [selectionStart, setSelectionStart] = useState<number | null>(null); // First click position
  const [touchStartTime, setTouchStartTime] = useState<number | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const { publish, subscribe, defaultRelays, pubkey } = useNostrContext();

  // Track last processed hash to prevent re-processing
  const lastHashRef = useRef<string>("");
  const actionBarRef = useRef<HTMLDivElement>(null);
  const isUserSelectionRef = useRef<boolean>(false); // Track if selection is from user interaction
  const [currentHash, setCurrentHash] = useState<string>(""); // Track hash changes
  const lastFilePathRef = useRef<string>(filePath); // Track file path changes
  const fileJustChangedRef = useRef<boolean>(false); // Track if file just changed

  // Clear selection when file changes - MUST run before hash parsing
  useEffect(() => {
    // Get current file from URL to detect file changes
    const currentFileFromUrl = searchParams?.get('file') || '';
    const fileChanged = filePath !== lastFilePathRef.current && filePath;
    const urlFileChanged = currentFileFromUrl !== lastFileFromUrlRef.current && currentFileFromUrl;
    
    if (fileChanged || urlFileChanged) {
      // File changed - clear all selection state IMMEDIATELY and synchronously
      setSelectedLines(null);
      setSelectionStart(null);
      setRangeMode(false);
      setShowSnippetModal(false);
      setSnippetDescription("");
      fileJustChangedRef.current = true; // Mark that file just changed
      
      if (urlFileChanged) {
        lastFileFromUrlRef.current = currentFileFromUrl;
      }
      
      // Clear hash synchronously if it contains line numbers (from previous file)
      if (typeof window !== 'undefined') {
        const hash = window.location.hash;
        if (hash && hash.match(/#L\d/)) {
          // Clear hash immediately - this must happen before hash parsing effect runs
          const url = new URL(window.location.href);
          url.hash = '';
          window.history.replaceState(null, '', url.toString());
          setCurrentHash('');
          lastHashRef.current = ''; // Clear hash ref immediately
        }
      }
      
      // Update file path ref AFTER clearing hash
      if (fileChanged) {
        lastFilePathRef.current = filePath;
      }
      
      // Reset the flag after a delay to allow hash parsing to skip
      setTimeout(() => {
        fileJustChangedRef.current = false;
      }, 500); // Increased delay to ensure hash parsing doesn't run
    }
  }, [filePath, searchParams]);

  // Single unified hash parsing effect - no flickering
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!content || content.length === 0) return;
    
    // Skip hash parsing if file just changed (prevents re-applying old selection)
    if (fileJustChangedRef.current) {
      return;
    }
    
    // If file path doesn't match, don't parse hash (file changed but effect hasn't run yet)
    if (filePath !== lastFilePathRef.current) {
      return;
    }
    
    // Also check URL file parameter to catch file changes
    const currentFileFromUrl = searchParams?.get('file') || '';
    if (currentFileFromUrl && currentFileFromUrl !== lastFileFromUrlRef.current && lastFileFromUrlRef.current) {
      // File in URL changed - don't apply hash from previous file
      return;
    }
    
    const hash = window.location.hash;
    
    // Skip if we've already processed this hash (unless it's a user selection)
    if (hash === lastHashRef.current && !isUserSelectionRef.current) {
      return;
    }
    
    // If hash exists but we just switched files, don't apply it
    if (hash && hash.match(/#L\d/) && fileJustChangedRef.current) {
      return;
    }
    
    // Reset user selection flag after processing
    isUserSelectionRef.current = false;
    lastHashRef.current = hash;
    
    const match = hash.match(/#L(\d+)(?:-L(\d+))?/);
    
    if (!match || !match[1]) {
      // No hash to parse - clear selection only if there's truly no hash
      if (!hash || !hash.includes('L')) {
        setSelectedLines(null);
      }
      return;
    }
    
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    const lines = content.split("\n");
    const maxLines = lines.length;
    
    if (start < 1 || start > maxLines || end < 1 || end > maxLines || end < start) {
      // Invalid line numbers - clear selection
      setSelectedLines(null);
      return;
    }
    
    // Set selection (React will handle re-render optimization)
    setSelectedLines({ start, end });
    
    // Scroll to action bar after DOM is ready
    setTimeout(() => {
      scrollToActionBar();
    }, 200);
    
    // Scroll to line after DOM is ready
    requestAnimationFrame(() => {
      setTimeout(() => {
        const lineElement = document.getElementById(`line-${start}`);
        if (lineElement) {
          lineElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    });
  }, [content, currentHash, filePath]); // Depend on currentHash to trigger on hash changes, and filePath to prevent applying old hash to new file

  // Listen for hash changes (navigation)
  useEffect(() => {
    // Set initial hash
    if (typeof window !== 'undefined') {
      setCurrentHash(window.location.hash);
    }
    
    const handleHashChange = () => {
      // Reset last hash so it gets re-processed
      lastHashRef.current = "";
      // Update hash state to trigger re-parse
      if (typeof window !== 'undefined') {
        setCurrentHash(window.location.hash);
      }
    };
    
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);
    
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
      }
    };
  }, [longPressTimer]);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [justDragged, setJustDragged] = useState(false);

  // Helper to scroll action bar into view
  const scrollToActionBar = () => {
    setTimeout(() => {
      if (actionBarRef.current) {
        actionBarRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 150);
  };

  const handleLineMouseDown = (lineNum: number, e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    setJustDragged(false);
    setDragStart(lineNum);
    setSelectionStart(lineNum);
    setSelectedLines({ start: lineNum, end: lineNum });
  };

  const handleLineMouseEnter = (lineNum: number, e: React.MouseEvent) => {
    if (isDragging && dragStart !== null) {
      const start = Math.min(dragStart, lineNum);
      const end = Math.max(dragStart, lineNum);
      setSelectedLines({ start, end });
    }
  };

  const handleLineMouseUp = (lineNum: number, e: React.MouseEvent) => {
    if (!isDragging) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    if (dragStart !== null) {
      const start = Math.min(dragStart, lineNum);
      const end = Math.max(dragStart, lineNum);
      setSelectedLines({ start, end });
      
      // Update URL
      const newHash = end > start ? `#L${start}-L${end}` : `#L${start}`;
      isUserSelectionRef.current = true; // Mark as user selection to prevent hash re-processing
      lastHashRef.current = newHash; // Update last hash
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
      scrollToActionBar();
      
      // Mark that we just dragged
      setJustDragged(true);
      // Clear the flag after a short delay so click handler knows
      setTimeout(() => setJustDragged(false), 100);
    }
    
    setIsDragging(false);
    setDragStart(null);
    setSelectionStart(null);
  };

  const handleLineClick = (lineNum: number, e: React.MouseEvent) => {
    // Ignore click if we just finished dragging
    if (justDragged || isDragging) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Two-click selection mode: first click sets start, second click sets end
    if (rangeMode && selectionStart !== null) {
      // Second click - complete the range
      const start = Math.min(selectionStart, lineNum);
      const end = Math.max(selectionStart, lineNum);
      setSelectedLines({ start, end });
      setSelectionStart(null);
      setRangeMode(false);
      
      // Update URL
      const newHash = end > start ? `#L${start}-L${end}` : `#L${start}`;
      isUserSelectionRef.current = true; // Mark as user selection
      lastHashRef.current = newHash;
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
      scrollToActionBar();
    } else if (rangeMode && selectionStart === null) {
      // First click in range mode - set start point
      setSelectionStart(lineNum);
      setSelectedLines({ start: lineNum, end: lineNum }); // Show preview
    } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // Keyboard modifier: extend from existing selection
      if (selectedLines) {
        const start = Math.min(selectedLines.start, lineNum);
        const end = Math.max(selectedLines.start, lineNum);
        setSelectedLines({ start, end });
        const newHash = end > start ? `#L${start}-L${end}` : `#L${start}`;
        window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
      } else {
        setSelectedLines({ start: lineNum, end: lineNum });
        const newHash = `#L${lineNum}`;
        isUserSelectionRef.current = true;
        lastHashRef.current = newHash;
        window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
      }
    } else {
      // Single click - select single line
      setSelectedLines({ start: lineNum, end: lineNum });
      setSelectionStart(null);
      const newHash = `#L${lineNum}`;
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
    }
  };
  
  // Handle mouse up anywhere to end drag
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragStart(null);
        setSelectionStart(null);
      }
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDragging]);

  // Mobile: Handle touch for range selection
  const handleLineTouchStart = (lineNum: number, e: React.TouchEvent) => {
    setTouchStartTime(Date.now());
    
    // Long press timer (500ms) for context menu
    const timer = setTimeout(() => {
      // Long press = copy permalink (mobile equivalent of right-click)
      const hash = selectedLines 
        ? (selectedLines.end > selectedLines.start ? `#L${selectedLines.start}-L${selectedLines.end}` : `#L${selectedLines.start}`)
        : `#L${lineNum}`;
      
      const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
      navigator.clipboard.writeText(fullUrl).then(() => {
        const toast = document.createElement("div");
        toast.className = "fixed bottom-4 right-4 bg-gray-800 border border-gray-600 text-white px-4 py-2 rounded shadow-lg z-50";
        toast.textContent = "Permalink copied to clipboard";
        document.body.appendChild(toast);
        setTimeout(() => {
          document.body.removeChild(toast);
        }, 2000);
      });
    }, 500);
    
    setLongPressTimer(timer);
  };

  const handleLineTouchEnd = (lineNum: number, e: React.TouchEvent) => {
    // Clear long press timer
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    // If it was a quick tap (not long press)
    if (touchStartTime && Date.now() - touchStartTime < 500) {
      e.preventDefault();
      
      if (rangeMode && selectionStart !== null) {
        // Second tap - complete the range
        const start = Math.min(selectionStart, lineNum);
        const end = Math.max(selectionStart, lineNum);
        setSelectedLines({ start, end });
        setSelectionStart(null);
        setRangeMode(false);
        
        const newHash = end > start ? `#L${start}-L${end}` : `#L${start}`;
        window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
        scrollToActionBar();
      } else if (rangeMode && selectionStart === null) {
        // First tap in range mode - set start point
        setSelectionStart(lineNum);
        setSelectedLines({ start: lineNum, end: lineNum }); // Show preview
      } else {
        // Normal mode: tap to select single line
        setSelectedLines({ start: lineNum, end: lineNum });
        setSelectionStart(null);
        const newHash = `#L${lineNum}`;
        isUserSelectionRef.current = true;
        lastHashRef.current = newHash;
        window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
        scrollToActionBar();
      }
    }
    
    setTouchStartTime(null);
  };

  const handleLineTouchCancel = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    setTouchStartTime(null);
  };

  const handleLineRightClick = (lineNum: number, e: React.MouseEvent) => {
    e.preventDefault();
    const hash = selectedLines 
      ? (selectedLines.end > selectedLines.start ? `#L${selectedLines.start}-L${selectedLines.end}` : `#L${selectedLines.start}`)
      : `#L${lineNum}`;
    
    const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
    
    navigator.clipboard.writeText(fullUrl).then(() => {
      // Show toast or feedback
      const toast = document.createElement("div");
      toast.className = "fixed bottom-4 right-4 bg-gray-800 border border-gray-600 text-white px-4 py-2 rounded shadow-lg z-50";
      toast.textContent = "Permalink copied to clipboard";
      document.body.appendChild(toast);
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 2000);
    });
  };

  const lines = content.split("\n");
  const isBinary = content.startsWith("http"); // Binary file indicator

  // No need for re-application effect - React will handle highlighting via className

  // Get selected code
  const getSelectedCode = (): string => {
    if (!selectedLines) return "";
    const start = selectedLines.start - 1; // Convert to 0-based index
    const end = selectedLines.end;
    return lines.slice(start, end).join("\n");
  };

  // Detect language from file extension
  const getLanguageFromExtension = (path: string): string | undefined => {
    const ext = path.split(".").pop()?.toLowerCase();
    if (!ext) return undefined;
    
    const langMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      c: "c",
      cpp: "cpp",
      h: "c",
      hpp: "cpp",
      cs: "csharp",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      fish: "bash",
      ps1: "powershell",
      sql: "sql",
      html: "html",
      css: "css",
      scss: "scss",
      sass: "sass",
      less: "less",
      json: "json",
      xml: "xml",
      yml: "yaml",
      yaml: "yaml",
      md: "markdown",
      markdown: "markdown",
      toml: "toml",
      ini: "ini",
      cfg: "ini",
      conf: "ini",
      dockerfile: "dockerfile",
      makefile: "makefile",
      cmake: "cmake",
    };
    
    return langMap[ext];
  };

  // Handle share as snippet
  const handleShareAsSnippet = async () => {
    if (!selectedLines || !publish || !subscribe || !defaultRelays) {
      alert("Cannot share snippet: Missing Nostr context or no selection");
      return;
    }

    const selectedCode = getSelectedCode();
    if (!selectedCode.trim()) {
      alert("No code selected");
      return;
    }

    setSnippetPublishing(true);
    try {
      // Check for NIP-07 extension
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      let privateKey: string | undefined;
      let userPubkey: string | undefined = pubkey || undefined;
      
      if (!hasNip07) {
        // No NIP-07, need private key
        privateKey = await getNostrPrivateKey() || undefined;
        if (!privateKey) {
          alert("No signing method available. Please use a NIP-07 extension or configure a private key in Settings.");
          setSnippetPublishing(false);
          return;
        }
        // Derive pubkey from private key
        const { getPublicKey } = await import("nostr-tools");
        userPubkey = getPublicKey(privateKey);
      } else if (!userPubkey) {
        // NIP-07 available but no pubkey in context, get it from extension
        try {
          userPubkey = await window.nostr.getPublicKey();
        } catch (e) {
          console.error("Failed to get pubkey from NIP-07:", e);
          alert("Failed to get public key from NIP-07 extension.");
          setSnippetPublishing(false);
          return;
        }
      }

      if (!userPubkey) {
        alert("Cannot share snippet: No public key available.");
        setSnippetPublishing(false);
        return;
      }

      // Get file extension and language
      const extension = filePath.split(".").pop()?.toLowerCase() || "";
      const language = getLanguageFromExtension(filePath);
      const fileName = filePath.split("/").pop() || "snippet";

      // Resolve entity to pubkey for NIP-34 repo reference
      let ownerPubkey: string | undefined;
      let repoReference: string | undefined;
      
      try {
        if (entity.startsWith("npub")) {
          const decoded = nip19.decode(entity);
          if (decoded.type === "npub") {
            ownerPubkey = decoded.data as string;
          }
        } else if (/^[0-9a-f]{64}$/i.test(entity)) {
          ownerPubkey = entity;
        }
        
        // Create NIP-34 format repo reference: "30617:<pubkey>:<d tag>"
        if (ownerPubkey && repo) {
          repoReference = `30617:${ownerPubkey}:${repo}`;
        }
      } catch (e) {
        console.warn("Failed to create repo reference:", e);
      }

      // Create snippet event (without signature if using NIP-07)
      let snippetEvent = createCodeSnippetEvent(
        {
          content: selectedCode,
          language: language,
          extension: extension,
          name: fileName,
          description: snippetDescription.trim() || undefined,
          repo: repoReference,
        },
        userPubkey,
        privateKey // Only provided if not using NIP-07
      );

      // Sign with NIP-07 if available
      if (hasNip07 && window.nostr && !privateKey) {
        try {
          console.log("🔐 [Code Snippet] Signing with NIP-07...");
          snippetEvent = await window.nostr.signEvent(snippetEvent as any);
          console.log("✅ [Code Snippet] Event signed with NIP-07");
        } catch (e: any) {
          console.error("Failed to sign with NIP-07:", e);
          alert(`Failed to sign snippet: ${e.message || "Unknown error"}`);
          setSnippetPublishing(false);
          return;
        }
      }

      // Publish with confirmation
      const result = await publishWithConfirmation(
        publish,
        subscribe,
        snippetEvent,
        defaultRelays,
        10000 // 10 second timeout
      );

      if (result.confirmed) {
        // Show success message
        const toast = document.createElement("div");
        toast.className = "fixed bottom-4 right-4 bg-green-800 border border-green-600 text-white px-4 py-2 rounded shadow-lg z-50";
        toast.textContent = `Snippet shared! Event ID: ${result.eventId.substring(0, 16)}...`;
        document.body.appendChild(toast);
        setTimeout(() => {
          document.body.removeChild(toast);
        }, 3000);
        
        setShowSnippetModal(false);
        setSnippetDescription("");
      } else {
        alert("Snippet published but not confirmed. It may appear shortly.");
        setShowSnippetModal(false);
        setSnippetDescription("");
      }
    } catch (error: any) {
      console.error("Failed to share snippet:", error);
      alert(`Failed to share snippet: ${error.message || "Unknown error"}`);
    } finally {
      setSnippetPublishing(false);
    }
  };

  if (isBinary) {
    return <div className="text-gray-400">Binary file - cannot display</div>;
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        {/* Line numbers - hidden on mobile */}
        <div className="hidden sm:block select-none text-right pr-4 text-gray-500 text-sm font-mono border-r border-gray-700">
          {lines.map((_, idx) => {
            const lineNum = idx + 1;
            // Calculate if this line is in the selected range
            const isSelected = selectedLines 
              ? (lineNum >= selectedLines.start && lineNum <= selectedLines.end)
              : false;
            const isStart = selectedLines && lineNum === selectedLines.start;
            const isEnd = selectedLines && lineNum === selectedLines.end;
            const isSelectionStart = selectionStart === lineNum && rangeMode;
            
            return (
              <div
                key={`line-num-${idx}-${selectedLines?.start}-${selectedLines?.end}-${selectionStart}`} // Force re-render on selection change
                id={`line-${lineNum}`}
                className={`
                  py-0.5 px-2 cursor-pointer transition-colors relative
                  ${isSelected 
                    ? "bg-yellow-600/60 text-yellow-50 font-semibold" 
                    : isSelectionStart
                    ? "bg-blue-600/40 text-blue-100 border-l-2 border-blue-400"
                    : "hover:bg-gray-800/50"
                  }
                  ${isStart && selectedLines && selectedLines.end > selectedLines.start ? "rounded-t-sm" : ""}
                  ${isEnd && selectedLines && selectedLines.end > selectedLines.start ? "rounded-b-sm" : ""}
                `}
                onMouseDown={(e) => handleLineMouseDown(lineNum, e)}
                onMouseEnter={(e) => handleLineMouseEnter(lineNum, e)}
                onMouseUp={(e) => handleLineMouseUp(lineNum, e)}
                onClick={(e) => handleLineClick(lineNum, e)}
                onContextMenu={(e) => handleLineRightClick(lineNum, e)}
                onTouchStart={(e) => handleLineTouchStart(lineNum, e)}
                onTouchEnd={(e) => handleLineTouchEnd(lineNum, e)}
                onTouchCancel={handleLineTouchCancel}
                style={{ userSelect: 'none' }}
                title={`Line ${lineNum}. Click to select. Use "Select Range" button for multi-line selection. Right-click to copy permalink.`}
              >
                {lineNum}
              </div>
            );
          })}
        </div>
        
        {/* Code content */}
        <div className="flex-1 overflow-x-auto relative sm:border-l-0 border-l border-gray-700">
          <pre className="whitespace-pre-wrap font-mono text-sm">
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              // Calculate if this line is in the selected range
              const isSelected = selectedLines 
                ? (lineNum >= selectedLines.start && lineNum <= selectedLines.end)
                : false;
              const isStart = selectedLines && lineNum === selectedLines.start;
              const isEnd = selectedLines && lineNum === selectedLines.end;
              const isSelectionStart = selectionStart === lineNum && rangeMode;
              
              return (
                <div
                  key={`line-content-${idx}-${selectedLines?.start}-${selectedLines?.end}-${selectionStart}`} // Force re-render on selection change
                  className={`
                    py-0.5 px-2 cursor-pointer transition-colors
                    ${isSelected 
                      ? "bg-yellow-600/60" 
                      : isSelectionStart
                      ? "bg-blue-600/40 border-l-2 border-blue-400"
                      : "hover:bg-gray-800/30"
                    }
                    ${isStart && selectedLines && selectedLines.end > selectedLines.start ? "rounded-t-sm" : ""}
                    ${isEnd && selectedLines && selectedLines.end > selectedLines.start ? "rounded-b-sm" : ""}
                  `}
                  onMouseDown={(e) => handleLineMouseDown(lineNum, e)}
                  onMouseEnter={(e) => handleLineMouseEnter(lineNum, e)}
                  onMouseUp={(e) => handleLineMouseUp(lineNum, e)}
                  onClick={(e) => handleLineClick(lineNum, e)}
                  onContextMenu={(e) => handleLineRightClick(lineNum, e)}
                  onTouchStart={(e) => handleLineTouchStart(lineNum, e)}
                  onTouchEnd={(e) => handleLineTouchEnd(lineNum, e)}
                  onTouchCancel={handleLineTouchCancel}
                  style={{ userSelect: 'none' }}
                >
                  {line || "\u00A0"}
                </div>
              );
            })}
          </pre>
          {/* Floating action bar appears right after the selected code */}
          {selectedLines && (
            <div 
              ref={actionBarRef}
              id="selection-action-bar"
              className="sticky top-2 z-10 my-2 p-2 bg-gray-900/95 backdrop-blur-sm border border-gray-600 rounded-lg shadow-lg"
              style={{ 
                scrollMarginTop: '80px' // Account for any fixed headers
              }}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                <span className="flex-shrink-0 font-semibold text-yellow-300 whitespace-nowrap">
                {selectedLines.end > selectedLines.start 
                    ? `Lines ${selectedLines.start}-${selectedLines.end}`
                    : `Line ${selectedLines.start}`
                }
              </span>
                <div className="flex flex-wrap items-center gap-2 flex-1">
              <button
                onClick={() => {
                      if (!selectedLines) return;
                  const hash = selectedLines.end > selectedLines.start 
                    ? `#L${selectedLines.start}-L${selectedLines.end}` 
                    : `#L${selectedLines.start}`;
                  const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
                  navigator.clipboard.writeText(fullUrl);
                  
                  // Show toast
                  const toast = document.createElement("div");
                  toast.className = "fixed bottom-4 right-4 bg-gray-800 border border-gray-600 text-white px-4 py-2 rounded shadow-lg z-50";
                  toast.textContent = "Permalink copied to clipboard";
                  document.body.appendChild(toast);
                  setTimeout(() => {
                    document.body.removeChild(toast);
                  }, 2000);
                }}
                    className="px-2 sm:px-3 py-1.5 sm:py-2 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white rounded text-xs sm:text-sm font-medium touch-manipulation transition-colors whitespace-nowrap"
              >
                Copy permalink
              </button>
                  {pubkey && (
                <button
                  onClick={() => setShowSnippetModal(true)}
                      className="px-2 sm:px-3 py-1.5 sm:py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded text-xs sm:text-sm font-medium flex items-center gap-1.5 touch-manipulation transition-colors whitespace-nowrap"
                >
                      <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span className="hidden sm:inline">Share as snippet</span>
                      <span className="sm:hidden">Share</span>
                </button>
              )}
            </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Selection instructions when no selection */}
      {!selectedLines && (
        <div className="mt-3 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
            <p className="text-sm text-gray-300 mb-2">Select code to share:</p>
          </div>
        )}
        
        {/* Range selection mode toggle - always visible */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (rangeMode) {
                // Cancel range mode
                setRangeMode(false);
                setSelectionStart(null);
                if (selectedLines && selectedLines.start === selectedLines.end) {
                  setSelectedLines(null);
                }
              } else {
                // Enter range mode
                setRangeMode(true);
                setSelectionStart(null);
                // Clear current selection when entering range mode
                setSelectedLines(null);
              }
            }}
            className={`px-4 py-2 rounded text-sm font-medium touch-manipulation transition-colors ${
              rangeMode 
                ? "bg-red-600 hover:bg-red-700 text-white" 
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {rangeMode ? "✕ Cancel Selection" : "📏 Select Range"}
          </button>
          
          {!rangeMode && (
            <span className="text-xs text-gray-400">
              Or click any line to select it, then use Shift/Ctrl+click to extend
            </span>
          )}
        </div>
        
        {/* Step-by-step instructions */}
        {rangeMode && selectionStart === null && (
          <div className="mt-3 p-3 bg-blue-900/40 border-2 border-blue-500 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-2xl">1️⃣</span>
              <div>
                <strong className="text-blue-200 text-sm">Step 1: Click the first line</strong>
                <p className="text-xs text-blue-300 mt-1">Click on the line number or code where you want your selection to start</p>
              </div>
            </div>
          </div>
        )}
        {rangeMode && selectionStart !== null && (
          <div className="mt-3 p-3 bg-green-900/40 border-2 border-green-500 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-2xl">2️⃣</span>
              <div>
                <strong className="text-green-200 text-sm">Step 2: Click the last line</strong>
                <p className="text-xs text-green-300 mt-1">Click on the line where you want your selection to end (currently starting at line {selectionStart})</p>
              </div>
            </div>
          </div>
        )}
        {!rangeMode && (
          <div className="mt-3 p-2 bg-gray-700/50 border border-gray-600 rounded text-xs text-gray-300">
            💡 <strong>Tip:</strong> You can also <strong>click and drag</strong> across lines to select a range instantly, or use "Select Range" for two-click selection
          </div>
        )}
        {!rangeMode && selectedLines && selectedLines.end === selectedLines.start && (
          <div className="mt-3 p-2 bg-yellow-900/30 border border-yellow-600 rounded text-xs text-yellow-200">
            💡 <strong>Want to select multiple lines?</strong> Click "Select Range" above, then click the first and last lines you want to share.
          </div>
        )}

      {/* Share Snippet Modal */}
      {showSnippetModal && selectedLines && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#171B21] border border-[#383B42] rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Share Code Snippet</h3>
              <button
                onClick={() => {
                  setShowSnippetModal(false);
                  setSnippetDescription("");
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Selected Code:</label>
                <pre className="bg-[#0a0d11] p-4 rounded text-xs overflow-x-auto max-h-48 overflow-y-auto">
                  <code>{getSelectedCode()}</code>
                </pre>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">
                  Description (optional):
                </label>
                <textarea
                  value={snippetDescription}
                  onChange={(e) => setSnippetDescription(e.target.value)}
                  placeholder="What does this code do?"
                  className="w-full bg-[#0a0d11] border border-[#383B42] rounded p-2 text-sm"
                  rows={3}
                />
              </div>

              <div className="text-xs text-gray-400">
                <p>Language: {getLanguageFromExtension(filePath) || "auto-detect"}</p>
                <p>File: {filePath}</p>
                {selectedLines ? (
                <p>Lines: {selectedLines.start}{selectedLines.end > selectedLines.start ? `-${selectedLines.end}` : ""}</p>
                ) : null}
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowSnippetModal(false);
                    setSnippetDescription("");
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                  disabled={snippetPublishing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleShareAsSnippet}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm flex items-center gap-2"
                  disabled={snippetPublishing}
                >
                  {snippetPublishing ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Share2 className="h-4 w-4" />
                      Share to Nostr
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

  useEffect(() => {
    // Parse line range from URL hash (#L10-L20 or #L10)
    const hash = window.location.hash;
    const match = hash.match(/#L(\d+)(?:-L(\d+))?/);
    
    if (match && match[1]) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : start;
      setSelectedLines({ start, end });
      
      // Scroll to line after a brief delay to ensure DOM is ready
      setTimeout(() => {
        const lineElement = document.getElementById(`line-${start}`);
        if (lineElement && containerRef.current) {
          lineElement.scrollIntoView({ behavior: "smooth", block: "center" });
          // Highlight selection
          lineElement.classList.add("bg-yellow-900/30");
          if (end > start) {
            for (let i = start + 1; i <= end; i++) {
              const el = document.getElementById(`line-${i}`);
              if (el) el.classList.add("bg-yellow-900/30");
            }
          }
        }
      }, 100);
    } else {
      setSelectedLines(null);
    }
  }, [content]);

  const handleLineClick = (lineNum: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectedLines) {
      // Extend selection
      const newEnd = lineNum;
      const start = Math.min(selectedLines.start, newEnd);
      const end = Math.max(selectedLines.start, newEnd);
      setSelectedLines({ start, end });
      
      // Update URL
      const newHash = end > start ? `#L${start}-L${end}` : `#L${start}`;
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
    } else {
      // Start new selection
      setSelectedLines({ start: lineNum, end: lineNum });
      const newHash = `#L${lineNum}`;
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
    }
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

  if (isBinary) {
    return <div className="text-gray-400">Binary file - cannot display</div>;
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        {/* Line numbers */}
        <div className="select-none text-right pr-4 text-gray-500 text-sm font-mono border-r border-gray-700">
          {lines.map((_, idx) => {
            const lineNum = idx + 1;
            const isSelected = selectedLines && lineNum >= selectedLines.start && lineNum <= selectedLines.end;
            
            return (
              <div
                key={idx}
                id={`line-${lineNum}`}
                className={`
                  py-0.5 px-2 cursor-pointer hover:bg-gray-800 transition-colors
                  ${isSelected ? "bg-yellow-900/30 text-yellow-200" : ""}
                `}
                onClick={(e) => handleLineClick(lineNum, e)}
                onContextMenu={(e) => handleLineRightClick(lineNum, e)}
                title={`Line ${lineNum}. Shift+click to select range. Right-click to copy permalink.`}
              >
                {lineNum}
              </div>
            );
          })}
        </div>
        
        {/* Code content */}
        <div className="flex-1 overflow-x-auto">
          <pre className="whitespace-pre-wrap font-mono text-sm">
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isSelected = selectedLines && lineNum >= selectedLines.start && lineNum <= selectedLines.end;
              
              return (
                <div
                  key={idx}
                  className={`
                    py-0.5 px-2
                    ${isSelected ? "bg-yellow-900/30" : ""}
                  `}
                  onClick={(e) => handleLineClick(lineNum, e)}
                  onContextMenu={(e) => handleLineRightClick(lineNum, e)}
                >
                  {line || "\u00A0"}
                </div>
              );
            })}
          </pre>
        </div>
      </div>
      
      {selectedLines && (
        <div className="mt-2 text-xs text-gray-400">
          Selected lines {selectedLines.start}
          {selectedLines.end > selectedLines.start && `-${selectedLines.end}`}
          {" "}
          <button
            onClick={() => {
              const hash = selectedLines.end > selectedLines.start 
                ? `#L${selectedLines.start}-L${selectedLines.end}` 
                : `#L${selectedLines.start}`;
              const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
              navigator.clipboard.writeText(fullUrl);
            }}
            className="text-purple-400 hover:text-purple-300 underline"
          >
            Copy permalink
          </button>
        </div>
      )}
    </div>
  );
}


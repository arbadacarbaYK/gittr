"use client";

import { useState } from "react";
import { Copy, Download, ExternalLink } from "lucide-react";
import { nip19 } from "nostr-tools";

interface CodeSnippetRendererProps {
  event: {
    id: string;
    pubkey: string;
    created_at: number;
    content: string;
    tags: string[][];
  };
  showAuthor?: boolean;
}

export function CodeSnippetRenderer({ event, showAuthor = true }: CodeSnippetRendererProps) {
  const [copied, setCopied] = useState(false);

  // Parse NIP-C0 tags
  const language = event.tags.find((t) => Array.isArray(t) && t[0] === "l")?.[1];
  const extension = event.tags.find((t) => Array.isArray(t) && t[0] === "extension")?.[1];
  const name = event.tags.find((t) => Array.isArray(t) && t[0] === "name")?.[1];
  const description = event.tags.find((t) => Array.isArray(t) && t[0] === "description")?.[1];
  const runtime = event.tags.find((t) => Array.isArray(t) && t[0] === "runtime")?.[1];
  const licenses = event.tags.filter((t) => Array.isArray(t) && t[0] === "license").map((t) => t[1]);
  const dependencies = event.tags.filter((t) => Array.isArray(t) && t[0] === "dep").map((t) => t[1]);
  const repoTag = event.tags.find((t) => Array.isArray(t) && t[0] === "repo");
  const repo = repoTag?.[1];
  const repoRelay = repoTag?.[2];

  // Parse NIP-34 repo reference: "30617:<pubkey>:<d tag>"
  const parseRepoReference = (ref: string): { pubkey?: string; repoName?: string } | null => {
    if (!ref) return null;
    
    // Check if it's NIP-34 format
    const nip34Match = ref.match(/^30617:([0-9a-f]{64}):(.+)$/i);
    if (nip34Match) {
      return {
        pubkey: nip34Match[1],
        repoName: nip34Match[2],
      };
    }
    
    // Otherwise it's a URL
    return null;
  };

  const repoRef = repo ? parseRepoReference(repo) : null;
  const repoUrl = repoRef && repoRef.pubkey && repoRef.repoName
    ? `/${nip19.npubEncode(repoRef.pubkey)}/${repoRef.repoName}`
    : repo && (repo.startsWith("http://") || repo.startsWith("https://"))
    ? repo
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(event.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleDownload = () => {
    const fileName = name || `snippet.${extension || "txt"}`;
    const blob = new Blob([event.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-[#383B42] rounded-lg bg-[#171B21] p-4 my-4">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          {name && (
            <div className="font-semibold text-white mb-1 flex items-center gap-2">
              <span>{name}</span>
              {language && (
                <span className="text-xs px-2 py-0.5 bg-purple-900/30 text-purple-300 rounded">
                  {language}
                </span>
              )}
            </div>
          )}
          {description && (
            <p className="text-sm text-gray-300 mb-2">{description}</p>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-gray-400">
            {runtime && <span>Runtime: {runtime}</span>}
            {licenses.length > 0 && <span>License: {licenses.join(", ")}</span>}
            {dependencies.length > 0 && <span>Deps: {dependencies.length}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Copy code"
          >
            <Copy className={`h-4 w-4 ${copied ? "text-green-400" : "text-gray-400"}`} />
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Download as file"
          >
            <Download className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Code */}
      <div className="bg-[#0a0d11] rounded p-4 overflow-x-auto">
        <pre className="text-sm font-mono">
          <code>{event.content}</code>
        </pre>
      </div>

      {/* Footer */}
      <div className="mt-3 flex justify-between items-center text-xs text-gray-500">
        <div className="flex items-center gap-3">
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-purple-400 hover:text-purple-300"
            >
              <ExternalLink className="h-3 w-3" />
              View source repository
            </a>
          )}
        </div>
        {showAuthor && (
          <div>
            <a
              href={`/${nip19.npubEncode(event.pubkey)}`}
              className="text-gray-400 hover:text-gray-300"
            >
              {nip19.npubEncode(event.pubkey).substring(0, 16)}...
            </a>
          </div>
        )}
      </div>
    </div>
  );
}


"use client";

import { useEffect, useId, useState } from "react";

interface MermaidRendererProps {
  code: string;
  className?: string;
}

export function MermaidRenderer({ code, className }: MermaidRendererProps) {
  const [diagram, setDiagram] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, "-");

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "dark",
        });
        let normalizedCode = code
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&nbsp;/g, " ")
          // Mermaid expects literal "\n" inside node labels, not real newlines
          .replace(/<br\s*\/?>/gi, "\\n")
          .replace(/\r\n/g, "\n");

        // Ensure labels containing line breaks stay within brackets by replacing remaining newlines with \n
        const wrapNewlines = (input: string, regex: RegExp) =>
          input.replace(regex, (_match, start: string, _newline: string, end: string) => `${start}\\n${end}`);

        normalizedCode = wrapNewlines(normalizedCode, /(\[[^\]]*)(\n)([^\]]*\])/g);
        normalizedCode = wrapNewlines(normalizedCode, /(\([^\)]*)(\n)([^\)]*\))/g);
        normalizedCode = wrapNewlines(normalizedCode, /(\{[^\}]*)(\n)([^\}]*\})/g);
        const { svg } = await mermaid.render(`mermaid-${renderId}`, normalizedCode);
        if (!cancelled) {
          setDiagram(svg);
          setError(null);
        }
      } catch (err) {
        console.error("❌ [MermaidRenderer] Failed to render diagram:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  if (error) {
    return (
      <details className="bg-red-950 text-red-300 p-3 rounded border border-red-700 text-sm">
        <summary className="cursor-pointer">Failed to render mermaid diagram</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs mt-2">
          {error}
        </pre>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs mt-2 text-gray-300">
          {code}
        </pre>
      </details>
    );
  }

  if (!diagram) {
    return <div className="text-gray-400 text-sm italic">Rendering diagram…</div>;
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: diagram }} />;
}


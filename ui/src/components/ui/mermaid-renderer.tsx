"use client";

import { useEffect, useId, useState } from "react";

interface MermaidRendererProps {
  code: string;
  className?: string;
}

/** Applied once — repeated initialize() races and can wipe classDef fills mid-paint. */
let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "antiscript",
        theme: "dark",
        // Dark theme forces light labels; our host highlights need dark fills + light text
        // that survive theme CSS. !important beats Mermaid’s default node fills.
        themeCSS: `
          g.node.youAreHere > rect,
          g.node.youAreHere > polygon,
          g.node.youAreHere > circle,
          g.node.youAreHere > path {
            fill: #0f766e !important;
            stroke: #5eead4 !important;
            stroke-width: 3px !important;
          }
          g.node.youAreHere span,
          g.node.youAreHere .nodeLabel,
          g.node.youAreHere foreignObject div,
          g.node.youAreHere foreignObject span {
            color: #ecfdf5 !important;
            fill: #ecfdf5 !important;
          }
          g.node.hostUrl > rect,
          g.node.hostUrl > polygon,
          g.node.hostUrl > circle,
          g.node.hostUrl > path {
            fill: #164e63 !important;
            stroke: #22d3ee !important;
            stroke-width: 2.5px !important;
          }
          g.node.hostUrl span,
          g.node.hostUrl .nodeLabel,
          g.node.hostUrl foreignObject div,
          g.node.hostUrl foreignObject span {
            color: #ecfeff !important;
            fill: #ecfeff !important;
          }
        `,
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

/** Belt-and-suspenders: dark theme sometimes strips class fills after paint. */
function enforceHighlightContrast(svg: string): string {
  if (typeof document === "undefined") return svg;
  try {
    // Parse as HTML, NOT XML. Mermaid htmlLabels serialize to HTML (unclosed
    // <br> inside <p>) which is fine in the DOM but fatal to an XML DOMParser:
    // that returns a <parsererror> document ("Opening and ending tag mismatch:
    // br and p") which we would then serialize and show instead of the diagram.
    const tpl = document.createElement("template");
    tpl.innerHTML = svg;
    const doc = tpl.content.querySelector("svg");
    if (!doc) return svg;
    const apply = (
      sel: string,
      fill: string,
      stroke: string,
      textFill: string,
      strokeWidth: string
    ) => {
      doc.querySelectorAll(sel).forEach((node) => {
        node.querySelectorAll("rect, polygon, circle, path, ellipse").forEach((shape) => {
          shape.setAttribute("fill", fill);
          shape.setAttribute("stroke", stroke);
          shape.setAttribute("stroke-width", strokeWidth);
          const s = (shape as SVGElement).style;
          if (s) {
            s.fill = fill;
            s.stroke = stroke;
          }
        });
        node.querySelectorAll("span, .nodeLabel, foreignObject div").forEach((el) => {
          (el as HTMLElement).style.color = textFill;
          el.setAttribute("fill", textFill);
        });
        node.querySelectorAll("text, tspan").forEach((el) => {
          el.setAttribute("fill", textFill);
        });
      });
    };
    apply("g.node.youAreHere", "#0f766e", "#5eead4", "#ecfdf5", "3");
    apply("g.node.hostUrl", "#164e63", "#22d3ee", "#ecfeff", "2.5");
    // HTML serialization (innerHTML) — the string is injected into HTML anyway.
    return tpl.innerHTML || svg;
  } catch {
    return svg;
  }
}

export function MermaidRenderer({ code, className }: MermaidRendererProps) {
  const [diagram, setDiagram] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, "-");

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = await getMermaid();
        // Keep <br/> in labels — Mermaid (and GitHub) use that for line breaks.
        // Do NOT turn them into the two-char sequence "\n" (that renders literally).
        let normalizedCode = code
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&nbsp;/g, " ")
          .replace(/\r\n/g, "\n");

        // Real newlines inside node labels → <br/> so Mermaid wraps the text
        const wrapNewlines = (input: string, regex: RegExp) =>
          input.replace(
            regex,
            (_match, start: string, _newline: string, end: string) =>
              `${start}<br/>${end}`
          );

        normalizedCode = wrapNewlines(
          normalizedCode,
          /(\[[^\]]*)(\n)([^\]]*\])/g
        );
        normalizedCode = wrapNewlines(
          normalizedCode,
          /(\([^\)]*)(\n)([^\)]*\))/g
        );
        normalizedCode = wrapNewlines(
          normalizedCode,
          /(\{[^\}]*)(\n)([^\}]*\})/g
        );
        const { svg } = await mermaid.render(
          `mermaid-${renderId}`,
          normalizedCode
        );
        if (!cancelled) {
          setDiagram(enforceHighlightContrast(svg));
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
        <summary className="cursor-pointer">
          Failed to render mermaid diagram
        </summary>
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
    return (
      <div className="text-gray-400 text-sm italic">Rendering diagram…</div>
    );
  }

  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: diagram }} />
  );
}

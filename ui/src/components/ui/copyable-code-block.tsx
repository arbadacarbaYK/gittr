"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyableCodeBlockProps {
  children: React.ReactNode;
  className?: string;
  inline?: boolean;
}

export function CopyableCodeBlock({ children, className = "", inline = false }: CopyableCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  
  // Extract text content from children
  const getCodeText = (): string => {
    if (typeof children === 'string') {
      return children;
    }
    if (Array.isArray(children)) {
      return children.map(child => {
        if (typeof child === 'string') return child;
        if (typeof child === 'object' && child !== null && 'props' in child) {
          return getCodeTextFromNode(child);
        }
        return String(child);
      }).join('');
    }
    if (typeof children === 'object' && children !== null) {
      return getCodeTextFromNode(children);
    }
    return String(children);
  };

  const getCodeTextFromNode = (node: any): string => {
    if (typeof node === 'string') return node;
    if (node.props?.children) {
      if (Array.isArray(node.props.children)) {
        return node.props.children.map((child: any) => getCodeTextFromNode(child)).join('');
      }
      return getCodeTextFromNode(node.props.children);
    }
    return '';
  };

  const codeText = getCodeText();
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = codeText;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  // For inline code, just render as normal code with copy on click
  if (inline) {
    return (
      <code 
        className={className}
        onClick={handleCopy}
        title="Click to copy"
        style={{ cursor: 'pointer', display: 'inline' }}
      >
        {children}
      </code>
    );
  }

  // For block code, render with copy button
  // Extract language class from className if present
  const hasLanguageClass = className && /language-/.test(className);
  const preClassName = hasLanguageClass 
    ? className.replace(/language-[\w-]+/, '').trim() || "bg-gray-900 rounded p-2 overflow-x-auto my-0.5"
    : className || "bg-gray-900 rounded p-2 overflow-x-auto my-0.5";
  const codeClassName = hasLanguageClass ? className : "";

  return (
    <div className="relative group">
      <pre className={preClassName}>
        <code className={codeClassName}>{children}</code>
      </pre>
      <Button
        onClick={handleCopy}
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800/80 hover:bg-gray-700/80 text-gray-300 hover:text-white h-7 px-2 z-10"
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 mr-1" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </>
        )}
      </Button>
    </div>
  );
}


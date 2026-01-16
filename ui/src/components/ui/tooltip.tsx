"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  /** If true, tooltip works on click/touch for mobile devices */
  mobileClickable?: boolean;
}

export function Tooltip({
  content,
  children,
  className = "",
  mobileClickable = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Clean content: remove extra newlines and trim whitespace
  const cleanedContent = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  // Close tooltip when clicking outside
  useEffect(() => {
    if (!mobileClickable || !isVisible) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isVisible, mobileClickable]);

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (mobileClickable) {
      e.preventDefault();
      e.stopPropagation();
      setIsVisible(!isVisible);
    }
  };

  return (
    <div
      className={`group relative inline-block ${className}`}
      onClick={mobileClickable ? handleClick : undefined}
      onTouchStart={mobileClickable ? handleClick : undefined}
    >
      {children}
      <div
        ref={tooltipRef}
        className={`absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-[#22262C] border border-[#383B42] rounded shadow-lg transition-opacity duration-200 pointer-events-none z-50 ${
          mobileClickable
            ? isVisible
              ? "opacity-100 pointer-events-auto"
              : "opacity-0"
            : "opacity-0 group-hover:opacity-100"
        }`}
        style={{
          // Prevent tooltip from extending beyond viewport on mobile
          maxWidth: "min(calc(100vw - 2rem), 24rem)",
          wordWrap: "break-word",
          overflowWrap: "break-word",
          whiteSpace: "normal", // Normal wrapping, don't preserve newlines
        }}
      >
        {cleanedContent}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-[#22262C]"></div>
      </div>
    </div>
  );
}

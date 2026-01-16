"use client";

import { ReactNode } from "react";

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * Global page container component that provides consistent responsive width
 * across all pages. Uses 95% width on mobile, 90% on xl screens, 85% on 2xl screens.
 *
 * This eliminates the need to set container widths on every page individually.
 */
export function PageContainer({
  children,
  className = "",
}: PageContainerProps) {
  return (
    <div
      className={`container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6 ${className}`}
    >
      {children}
    </div>
  );
}

"use client";

import { useCallback, useLayoutEffect, useState } from "react";

import {
  isGittrAndroidShell,
  rememberGittrAndroidShellFromLocation,
} from "@/lib/repo/gittr-android-shell";
import { runGittrAndroidUpdateCheck } from "@/lib/repo/gittr-android-update";
import { cn } from "@/lib/utils";

import { DropdownMenuItem } from "./dropdown-menu";

export function GittrAndroidUpdateMenuItem({
  variant,
  className,
  onClick,
}: {
  variant: "dropdown" | "row" | "button";
  className?: string;
  onClick?: () => void;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    rememberGittrAndroidShellFromLocation();
    setShow(isGittrAndroidShell());
  }, []);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runGittrAndroidUpdateCheck();
    } finally {
      setBusy(false);
      onClick?.();
    }
  }, [busy, onClick]);

  if (!show) return null;

  const label = busy ? "Checking…" : "Update app";

  if (variant === "dropdown") {
    return (
      <DropdownMenuItem disabled={busy} onSelect={() => void run()}>
        {label}
      </DropdownMenuItem>
    );
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        className={className}
        onClick={() => void run()}
        disabled={busy}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className={cn(
        "hover:text-gray-400 flex w-full items-center border-b border-b-lightgray p-3 text-left text-sm font-medium",
        className
      )}
    >
      {label}
    </button>
  );
}

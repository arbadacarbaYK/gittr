"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { ZapButton } from "./zap-button";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getZapCount } from "@/lib/payments/zap-tracker";

interface TipjarButtonProps {
  recipient: string; // pubkey/npub
  contextId?: string; // repo/issue/PR ID
  contextType?: "repo" | "issue" | "pr" | "user";
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "lg";
  className?: string;
}

export function TipjarButton({
  recipient,
  contextId,
  contextType = "user",
  variant = "outline",
  size = "sm",
  className
}: TipjarButtonProps) {
  const { pubkey } = useNostrContext();
  const zapCount = getZapCount(recipient, contextId, contextType);
  
  return (
    <div className="flex items-center gap-2">
      <ZapButton
        recipient={recipient}
        comment={contextId ? `Zap for ${contextType}` : undefined}
        variant={variant}
        size={size}
        className={className}
      />
      {zapCount > 0 && (
        <span className="text-sm text-gray-400">
          {zapCount} sats
        </span>
      )}
    </div>
  );
}


"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import { AlertCircle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  const isChunkError =
    /loading chunk|chunkloaderror|failed to fetch dynamically imported module/i.test(
      error.message || ""
    );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
      <h2 className="text-2xl font-bold mb-2">Something went wrong!</h2>
      <p className="text-gray-400 mb-4 text-center max-w-md">
        {isChunkError
          ? "The app was updated while this tab was open. Reload to get the latest version."
          : error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-4">
        {isChunkError ? (
          <Button onClick={() => window.location.reload()} variant="default">
            Reload page
          </Button>
        ) : (
          <Button onClick={reset} variant="default">
            Try again
          </Button>
        )}
        <Button onClick={() => (window.location.href = "/")} variant="outline">
          Go home
        </Button>
      </div>
    </div>
  );
}

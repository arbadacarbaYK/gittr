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
    // Log the error to an error reporting service
    console.error("Repository page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
      <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
      <h2 className="text-2xl font-bold mb-2">Something went wrong!</h2>
      <p className="text-gray-400 mb-4 text-center max-w-md">
        {error.message ||
          "An unexpected error occurred while loading this repository."}
      </p>
      <div className="flex gap-4">
        <Button onClick={reset} variant="default">
          Try again
        </Button>
        <Button onClick={() => (window.location.href = "/")} variant="outline">
          Go home
        </Button>
      </div>
    </div>
  );
}

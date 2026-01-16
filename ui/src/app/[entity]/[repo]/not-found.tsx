"use client";

import { Button } from "@/components/ui/button";

import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
      <FileQuestion className="h-12 w-12 text-gray-400 mb-4" />
      <h2 className="text-2xl font-bold mb-2">Repository not found</h2>
      <p className="text-gray-400 mb-4 text-center max-w-md">
        The repository you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex gap-4">
        <Link href="/">
          <Button variant="default">Go home</Button>
        </Link>
        <Link href="/explore">
          <Button variant="outline">Explore repositories</Button>
        </Link>
      </div>
    </div>
  );
}

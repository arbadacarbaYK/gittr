"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPendingUpload } from "@/lib/pending-changes";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";

export default function NewFilePage({ params }: { params: { entity: string; repo: string } }) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();
  const { pubkey } = useNostrContext();
  const { isLoggedIn } = useSession();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isLoggedIn || !pubkey) {
      setStatus("Error: You must be logged in to create files");
      return;
    }

    if (!path.trim()) {
      setStatus("Error: File path is required");
      return;
    }

    try {
      // Add as pending upload (will be part of PR)
      if (!pubkey) {
        setStatus("Error: You must be logged in to create files");
        return;
      }
      addPendingUpload(params.entity, params.repo, pubkey, { path: path.trim(), content, timestamp: Date.now() });
      
      setStatus("File added! Redirecting to create pull request...");
      setTimeout(() => {
        router.push(`/${params.entity}/${params.repo}/pulls/new`);
      }, 1000);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <Link href={`/${params.entity}/${params.repo}`} className="text-purple-500 hover:underline">
          ← Back to repository
        </Link>
      </div>
      
      <h1 className="text-2xl font-bold mb-4">Create new file</h1>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-2">File path</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="path/to/file.txt"
            className="w-full border p-2 text-black rounded"
            required
          />
          <p className="text-sm text-gray-400 mt-1">
            Use forward slashes (/) to create directories. Example: src/components/Button.tsx
          </p>
        </div>

        <div>
          <label className="block mb-2">File content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter file content here..."
            className="w-full border p-2 text-black rounded font-mono"
            rows={20}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Create file
          </button>
          <Link
            href={`/${params.entity}/${params.repo}`}
            className="px-4 py-2 border rounded hover:bg-gray-800"
          >
            Cancel
          </Link>
        </div>

        {status && (
          <div className={`p-3 rounded ${status.includes("Error") ? "bg-red-900" : "bg-green-900"}`}>
            {status}
          </div>
        )}
      </form>
    </div>
  );
}

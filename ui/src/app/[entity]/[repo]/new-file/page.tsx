"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPendingUpload } from "@/lib/pending-changes";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { loadStoredRepos, addFilesToRepo, normalizeFilePath } from "@/lib/repos/storage";
import { isOwner } from "@/lib/repo-permissions";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { nip19 } from "nostr-tools";

export default function NewFilePage({ params }: { params: { entity: string; repo: string } }) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();
  const { pubkey } = useNostrContext();
  const { isLoggedIn } = useSession();
  const [isOwnerUser, setIsOwnerUser] = useState<boolean | null>(null);

  // Check if user is owner
  useEffect(() => {
    if (!pubkey) {
      setIsOwnerUser(false);
      return;
    }

    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName(repos, params.entity, params.repo);

      const entityMatchesCurrentUser = (() => {
        if (!pubkey) return false;
        const hex = pubkey.toLowerCase();
        if (params.entity?.toLowerCase() === hex) return true;
        try {
          const npub = nip19.npubEncode(pubkey);
          return params.entity === npub;
        } catch {
          return false;
        }
      })();

      if (repo) {
        const ownerPubkey = getRepoOwnerPubkey(repo, params.entity);
        const userIsOwner = isOwner(pubkey, repo.contributors, ownerPubkey);
        setIsOwnerUser(userIsOwner || entityMatchesCurrentUser);
      } else {
        setIsOwnerUser(entityMatchesCurrentUser);
      }
    } catch (error) {
      console.error("Error checking owner status:", error);
      setIsOwnerUser(false);
    }
  }, [pubkey, params.entity, params.repo]);

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

    // Normalize path (remove leading/trailing slashes)
    const normalizedPath = normalizeFilePath(path.trim());
    if (!normalizedPath) {
      setStatus("Error: Invalid file path. Path cannot be just '/' or empty.");
      return;
    }

    try {
      // If user is owner, add file directly to repo (immediate display)
      if (isOwnerUser) {
        const success = addFilesToRepo(params.entity, params.repo, [
          { path: normalizedPath, content, type: "file" }
        ], pubkey);
        
        if (success) {
          setStatus("File created! Redirecting to repository...");
          setTimeout(() => {
            router.push(`/${params.entity}/${params.repo}`);
          }, 1000);
        } else {
          setStatus("Error: Failed to add file to repository");
        }
      } else {
        // Non-owners: Add as pending upload (requires PR)
        addPendingUpload(params.entity, params.repo, pubkey, { 
          path: normalizedPath, 
          content, 
          timestamp: Date.now() 
        });
      
      setStatus("File added! Redirecting to create pull request...");
      setTimeout(() => {
        router.push(`/${params.entity}/${params.repo}/pulls/new`);
      }, 1000);
      }
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
            {isOwnerUser && (
              <span className="block mt-1 text-green-400">
                ✓ You are the owner - file will be added directly (no PR needed)
              </span>
            )}
            {isOwnerUser === false && (
              <span className="block mt-1 text-yellow-400">
                ⚠ You are not the owner - file will require a Pull Request
              </span>
            )}
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

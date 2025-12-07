"use client";

import { useState, useRef, useEffect, use } from "react";
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

export default function UploadPage({ params }: { params: Promise<{ entity: string; repo: string }> }) {
  const resolvedParams = use(params);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      const repo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);

      const entityMatchesCurrentUser = (() => {
        if (!pubkey) return false;
        const hex = pubkey.toLowerCase();
        if (resolvedParams.entity?.toLowerCase() === hex) return true;
        try {
          const npub = nip19.npubEncode(pubkey);
          return resolvedParams.entity === npub;
        } catch {
          return false;
        }
      })();

      if (repo) {
        const ownerPubkey = getRepoOwnerPubkey(repo, resolvedParams.entity);
        const userIsOwner = isOwner(pubkey, repo.contributors, ownerPubkey);
        setIsOwnerUser(userIsOwner || entityMatchesCurrentUser);
      } else {
        setIsOwnerUser(entityMatchesCurrentUser);
      }
    } catch (error) {
      console.error("Error checking owner status:", error);
      setIsOwnerUser(false);
    }
  }, [pubkey, resolvedParams.entity, resolvedParams.repo]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (!isLoggedIn || !pubkey) {
      setStatus("Error: You must be logged in to upload files");
      return;
    }

    if (files.length === 0) {
      setStatus("Error: Please select at least one file");
      return;
    }

    setUploading(true);
    setStatus("Reading files...");

    try {
      // Read all files
      const fileData: Array<{ path: string; content: string; type: string; isBinary: boolean }> = [];
      for (const file of files) {
        const { content, isBinary } = await readFileContent(file);
        const normalizedPath = normalizeFilePath(file.name);
        if (normalizedPath) {
          fileData.push({ 
            path: normalizedPath, 
            content, 
            type: file.type || "file",
            isBinary
          });
        }
      }

      if (fileData.length === 0) {
        setStatus("Error: No valid files after processing");
        setUploading(false);
        return;
      }

      // If user is owner, add files directly to repo (immediate display)
      if (isOwnerUser) {
        const success = addFilesToRepo(resolvedParams.entity, resolvedParams.repo, fileData, pubkey);
        
        if (success) {
          setStatus(`Added ${fileData.length} file(s)! Redirecting to repository...`);
          setTimeout(() => {
            router.push(`/${resolvedParams.entity}/${resolvedParams.repo}`);
          }, 1000);
        } else {
          setStatus("Error: Failed to add files to repository");
          setUploading(false);
        }
      } else {
        // Non-owners: Add as pending uploads (requires PR)
        for (const file of fileData) {
          addPendingUpload(resolvedParams.entity, resolvedParams.repo, pubkey, { 
            path: file.path, 
            content: file.content, 
            timestamp: Date.now(),
            isBinary: file.isBinary,
            mimeType: file.type
          });
      }

        setStatus(`Added ${fileData.length} file(s)! Redirecting to create pull request...`);
      setTimeout(() => {
        router.push(`/${resolvedParams.entity}/${resolvedParams.repo}/pulls/new`);
      }, 1000);
      }
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      setUploading(false);
    }
  };

  /**
   * Read file content - handles both text and binary files
   * Returns: { content: string, isBinary: boolean }
   * - Text files: content is the text string
   * - Binary files: content is base64-encoded string
   */
  const readFileContent = (file: File): Promise<{ content: string; isBinary: boolean }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      // Detect if file is binary by extension or MIME type
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'log', 'csv', 'tsv', 'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sql', 'r', 'm', 'swift', 'kt', 'scala', 'clj', 'hs', 'elm', 'ex', 'exs', 'erl', 'hrl', 'ml', 'mli', 'fs', 'fsx', 'vb', 'cs', 'dart', 'lua', 'vim', 'vimrc', 'gitignore', 'gitattributes', 'dockerfile', 'makefile', 'cmake', 'gradle', 'maven', 'pom', 'sbt', 'build', 'rakefile', 'gemfile', 'podfile', 'cartfile'];
      const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav', 'avi', 'mov', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin'];
      
      const isBinaryByExt = binaryExts.includes(ext);
      const isTextByExt = textExts.includes(ext);
      const isBinaryByMime = file.type && (
        file.type.startsWith('image/') || 
        file.type.startsWith('video/') || 
        file.type.startsWith('audio/') || 
        file.type === 'application/pdf' || 
        file.type.startsWith('font/') || 
        file.type === 'application/octet-stream'
      );
      const isTextByMime = file.type && (
        file.type.startsWith('text/') || 
        file.type === 'application/json' || 
        file.type === 'application/xml'
      );
      
      const isBinary = (isBinaryByExt || isBinaryByMime) && !isTextByExt && !isTextByMime;
      
      reader.onload = (e) => {
        const result = e.target?.result;
        if (!result) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        if (isBinary) {
          // For binary files, readAsDataURL gives us "data:image/png;base64,..."
          // We need to extract just the base64 part
          if (typeof result === 'string') {
            const base64 = result.includes(',') ? (result.split(',')[1] || result) : result;
            if (base64) {
              resolve({ content: base64, isBinary: true });
            } else {
              reject(new Error('Failed to extract base64 from binary file'));
            }
          } else {
            reject(new Error('Failed to read binary file'));
          }
        } else {
          // For text files, result is the text string
          const textContent = typeof result === 'string' ? result : String(result);
          resolve({ content: textContent, isBinary: false });
        }
      };
      reader.onerror = reject;
      
      if (isBinary) {
        reader.readAsDataURL(file); // For binary files, use readAsDataURL
      } else {
        reader.readAsText(file); // For text files, use readAsText
      }
    });
  };

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <Link href={`/${resolvedParams.entity}/${resolvedParams.repo}`} className="text-purple-500 hover:underline">
          ← Back to repository
        </Link>
      </div>
      
      <h1 className="text-2xl font-bold mb-4">Upload files</h1>
      
      <div className="space-y-4">
        <div>
          <label className="block mb-2">Select files</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="w-full border p-2 text-black rounded"
          />
          <p className="text-sm text-gray-400 mt-1">
            You can select multiple files.
            {isOwnerUser && (
              <span className="block mt-1 text-green-400">
                ✓ You are the owner - files will be added directly (no PR needed)
              </span>
            )}
            {isOwnerUser === false && (
              <span className="block mt-1 text-yellow-400">
                ⚠ You are not the owner - files will require a Pull Request
              </span>
            )}
          </p>
        </div>

        {files.length > 0 && (
          <div>
            <h3 className="font-semibold mb-2">Selected files ({files.length}):</h3>
            <ul className="list-disc list-inside space-y-1">
              {files.map((file, idx) => (
                <li key={idx} className="text-gray-300">
                  {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            disabled={uploading || files.length === 0}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? "Uploading..." : "Upload files"}
          </button>
          <Link
            href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
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
      </div>
    </div>
  );
}

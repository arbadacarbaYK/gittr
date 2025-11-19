"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPendingUpload } from "@/lib/pending-changes";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";

export default function UploadPage({ params }: { params: { entity: string; repo: string } }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { pubkey } = useNostrContext();
  const { isLoggedIn } = useSession();

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
      // Read all files and add as pending uploads
      if (!pubkey) {
        setStatus("Error: You must be logged in to upload files");
        return;
      }
      for (const file of files) {
        const content = await readFileAsText(file);
        addPendingUpload(params.entity, params.repo, pubkey, { path: file.name, content, timestamp: Date.now() });
      }

      setStatus(`Added ${files.length} file(s)! Redirecting to create pull request...`);
      setTimeout(() => {
        router.push(`/${params.entity}/${params.repo}/pulls/new`);
      }, 1000);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      setUploading(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <Link href={`/${params.entity}/${params.repo}`} className="text-purple-500 hover:underline">
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
            You can select multiple files. They will be added to a pull request.
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
      </div>
    </div>
  );
}

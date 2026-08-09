"use client";

import {
  type ChangeEvent,
  type DragEvent,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { addPendingUpload } from "@/lib/pending-changes";
import { isOwner } from "@/lib/repo-permissions";
import { ensureLocalRepoForEdit } from "@/lib/repos/ensure-local-repo-for-edit";
import {
  addFilesToRepo,
  loadStoredRepos,
  normalizeFilePath,
} from "@/lib/repos/storage";
import { splitStagedUploadsByGitignore } from "@/lib/repos/gitignore-upload-filter";
import {
  type StagedUploadFile,
  mergeStagedUploads,
  pathFromUploadFile,
} from "@/lib/repos/upload-paths";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { nip19 } from "nostr-tools";

type StagedFile = StagedUploadFile;

function readEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string
): Promise<StagedFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    const path = normalizeFilePath(
      prefix ? `${prefix}/${file.name}` : file.name
    );
    return path ? [{ file, path }] : [];
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const children = await readEntries(dirEntry.createReader());
    const nested = await Promise.all(
      children.map((child) => walkEntry(child, nextPrefix))
    );
    return nested.flat();
  }
  return [];
}

async function stagedFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<StagedFile[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]?.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const nested = await Promise.all(entries.map((e) => walkEntry(e, "")));
      return nested.flat();
    }
  }
  return Array.from(dataTransfer.files || []).map((file) => ({
    file,
    path: pathFromUploadFile(file),
  }));
}

export default function UploadPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const resolvedParams = use(params);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  // Async gitignore filtering needs the latest staged list outside setState
  const stagedRef = useRef<StagedFile[]>([]);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { pubkey } = useNostrContext();
  const { isLoggedIn } = useSession();
  const [isOwnerUser, setIsOwnerUser] = useState<boolean | null>(null);

  useEffect(() => {
    // React/TS don't type webkitdirectory; set on the DOM node so Choose folder
    // actually opens a directory picker (and keeps nested paths).
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
    el.setAttribute("mozdirectory", "");
  }, []);

  useEffect(() => {
    if (!pubkey) {
      setIsOwnerUser(false);
      return;
    }

    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );

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

  // Merge, then re-filter the whole set against the .gitignore files it
  // contains (works no matter which order files/folders were added in).
  const stageWithGitignore = useCallback(
    async (prev: StagedFile[], incoming: StagedFile[]): Promise<StagedFile[]> => {
      const merged = mergeStagedUploads(prev, incoming);
      try {
        const { kept, skipped } = await splitStagedUploadsByGitignore(merged);
        if (skipped.length > 0) {
          setStatus(
            `Skipped ${skipped.length} ignored file(s) (.gitignore / .git internals)`
          );
        }
        return kept;
      } catch {
        return merged;
      }
    },
    []
  );

  const addFromFileList = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list).map((file) => ({
        file,
        path: pathFromUploadFile(file),
      }));
      void (async () => {
        const prev = stagedRef.current;
        const next = await stageWithGitignore(prev, incoming);
        setStaged(next);
      })();
    },
    [stageWithGitignore]
  );

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const incoming = Array.from(e.target.files).map((file) => ({
        file,
        path: pathFromUploadFile(file),
      }));
      const nested = incoming.filter((s) => s.path.includes("/")).length;
      console.log(
        `📂 [Upload] Selected ${incoming.length} file(s), ${nested} with folder path(s)`,
        incoming.map((s) => s.path).slice(0, 20)
      );
      if (
        e.target === folderInputRef.current &&
        incoming.length > 0 &&
        nested === 0
      ) {
        setStatus(
          "Warning: folder paths were not detected (files landed at repo root). Try Drag & drop the folder instead of Choose folder."
        );
      }
      void (async () => {
        const next = await stageWithGitignore(stagedRef.current, incoming);
        setStaged(next);
      })();
    }
    // Allow selecting the same folder/files again
    e.target.value = "";
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    try {
      const incoming = await stagedFromDataTransfer(e.dataTransfer);
      const next = await stageWithGitignore(stagedRef.current, incoming);
      setStaged(next);
    } catch (err) {
      console.error("Drop failed:", err);
      setStatus("Error: Could not read dropped files or folders");
    }
  };

  const handleUpload = async () => {
    if (!isLoggedIn || !pubkey) {
      setStatus("Error: You must be logged in to upload files");
      return;
    }

    if (staged.length === 0) {
      setStatus("Error: Please select at least one file or folder");
      return;
    }

    setUploading(true);
    setStatus("Reading files...");

    try {
      const fileData: Array<{
        path: string;
        content: string;
        type: string;
        isBinary: boolean;
      }> = [];
      for (const { file, path } of staged) {
        const { content, isBinary } = await readFileContent(file);
        const normalizedPath = normalizeFilePath(path);
        if (normalizedPath) {
          fileData.push({
            path: normalizedPath,
            content,
            type: file.type || "file",
            isBinary,
          });
        }
      }

      if (fileData.length === 0) {
        setStatus("Error: No valid files after processing");
        setUploading(false);
        return;
      }

      if (isOwnerUser) {
        setStatus("Preparing local copy...");
        const existing = findRepoByEntityAndName(
          loadStoredRepos(),
          resolvedParams.entity,
          resolvedParams.repo
        );
        const ownerPubkey =
          getRepoOwnerPubkey(existing, resolvedParams.entity) ||
          resolveEntityToPubkey(resolvedParams.entity) ||
          pubkey;
        const ensured = await ensureLocalRepoForEdit({
          entity: resolvedParams.entity,
          repo: resolvedParams.repo,
          ownerPubkey,
          defaultBranch:
            (existing as { defaultBranch?: string } | null)?.defaultBranch ||
            "main",
        });
        if (!ensured.ok) {
          setStatus(
            `Error: ${
              ensured.error ||
              "Could not prepare a local copy of this repository"
            }. Use Refresh from gittr on the Code tab, then upload again.`
          );
          setUploading(false);
          return;
        }
        if (ensured.hydratedFromBridge || ensured.createdShell) {
          setStatus(
            ensured.hydratedFromBridge
              ? `Loaded ${ensured.fileCount} existing file(s) from gittr, merging your upload...`
              : "Created local repo copy, adding your files..."
          );
        }

        const success = addFilesToRepo(
          resolvedParams.entity,
          resolvedParams.repo,
          fileData,
          pubkey
        );

        if (success) {
          setStatus(
            `Added ${fileData.length} file(s)! Redirecting to repository...`
          );
          setTimeout(() => {
            router.push(`/${resolvedParams.entity}/${resolvedParams.repo}`);
          }, 1000);
        } else {
          setStatus(
            "Error: Failed to add files to repository. Try Refresh from gittr on the Code tab first, then upload again."
          );
          setUploading(false);
        }
      } else {
        for (const file of fileData) {
          addPendingUpload(resolvedParams.entity, resolvedParams.repo, pubkey, {
            path: file.path,
            content: file.content,
            timestamp: Date.now(),
            isBinary: file.isBinary,
            mimeType: file.type,
          });
        }

        setStatus(
          `Added ${fileData.length} file(s)! Redirecting to create pull request...`
        );
        setTimeout(() => {
          router.push(
            `/${resolvedParams.entity}/${resolvedParams.repo}/pulls/new`
          );
        }, 1000);
      }
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      setUploading(false);
    }
  };

  const readFileContent = (
    file: File
  ): Promise<{ content: string; isBinary: boolean }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const textExts = [
        "txt",
        "md",
        "json",
        "js",
        "ts",
        "jsx",
        "tsx",
        "css",
        "html",
        "htm",
        "xml",
        "yml",
        "yaml",
        "toml",
        "ini",
        "conf",
        "log",
        "csv",
        "tsv",
        "sh",
        "bash",
        "zsh",
        "fish",
        "py",
        "rb",
        "go",
        "rs",
        "java",
        "c",
        "cpp",
        "h",
        "hpp",
        "sql",
        "r",
        "m",
        "swift",
        "kt",
        "scala",
        "clj",
        "hs",
        "elm",
        "ex",
        "exs",
        "erl",
        "hrl",
        "ml",
        "mli",
        "fs",
        "fsx",
        "vb",
        "cs",
        "dart",
        "lua",
        "vim",
        "vimrc",
        "gitignore",
        "gitattributes",
        "dockerfile",
        "makefile",
        "cmake",
        "gradle",
        "maven",
        "pom",
        "sbt",
        "build",
        "rakefile",
        "gemfile",
        "podfile",
        "cartfile",
      ];
      const binaryExts = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "svg",
        "ico",
        "pdf",
        "woff",
        "woff2",
        "ttf",
        "otf",
        "eot",
        "mp4",
        "mp3",
        "wav",
        "avi",
        "mov",
        "zip",
        "tar",
        "gz",
        "bz2",
        "xz",
        "7z",
        "rar",
        "exe",
        "dll",
        "so",
        "dylib",
        "bin",
      ];

      const isBinaryByExt = binaryExts.includes(ext);
      const isTextByExt = textExts.includes(ext);
      const isBinaryByMime =
        file.type &&
        (file.type.startsWith("image/") ||
          file.type.startsWith("video/") ||
          file.type.startsWith("audio/") ||
          file.type === "application/pdf" ||
          file.type.startsWith("font/") ||
          file.type === "application/octet-stream");
      const isTextByMime =
        file.type &&
        (file.type.startsWith("text/") ||
          file.type === "application/json" ||
          file.type === "application/xml");

      const isBinary =
        (isBinaryByExt || isBinaryByMime) && !isTextByExt && !isTextByMime;

      reader.onload = (e) => {
        const result = e.target?.result;
        if (!result) {
          reject(new Error("Failed to read file"));
          return;
        }

        if (isBinary) {
          if (typeof result === "string") {
            const base64 = result.includes(",")
              ? result.split(",")[1] || result
              : result;
            if (base64) {
              resolve({ content: base64, isBinary: true });
            } else {
              reject(new Error("Failed to extract base64 from binary file"));
            }
          } else {
            reject(new Error("Failed to read binary file"));
          }
        } else {
          const textContent =
            typeof result === "string" ? result : String(result);
          resolve({ content: textContent, isBinary: false });
        }
      };
      reader.onerror = reject;

      if (isBinary) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const canUpload = !uploading && staged.length > 0;

  return (
    <div className="container mx-auto max-w-4xl p-6 text-[var(--color-text-primary)]">
      <div className="mb-4">
        <Link
          href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
          className="text-[var(--color-accent-primary)] hover:underline"
        >
          ← Back to repository
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-4">Upload files & folders</h1>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-[var(--color-text-primary)]">
            Add files or folders
          </label>

          <div
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`relative rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors ${
              dragOver
                ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/10"
                : "border-[var(--color-border)] bg-[var(--color-bg-dark)]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute h-px w-px -m-px overflow-hidden whitespace-nowrap border-0 p-0 opacity-0"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute h-px w-px -m-px overflow-hidden whitespace-nowrap border-0 p-0 opacity-0"
            />
            <p className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
              Drag & drop files or folders here
            </p>
            <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
              Nested folders keep their paths (e.g.{" "}
              <code className="text-xs">src/app/page.tsx</code>)
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)]"
              >
                Choose files
              </button>
              <button
                type="button"
                onClick={() => {
                  const el = folderInputRef.current;
                  if (!el) return;
                  el.setAttribute("webkitdirectory", "");
                  el.setAttribute("directory", "");
                  el.setAttribute("mozdirectory", "");
                  el.click();
                }}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)]"
              >
                Choose folder
              </button>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              {staged.length === 0
                ? "Nothing selected yet"
                : (() => {
                    const nested = staged.filter((s) =>
                      s.path.includes("/")
                    ).length;
                    return `${staged.length} file${
                      staged.length === 1 ? "" : "s"
                    } ready${
                      nested > 0
                        ? ` (${nested} with folder path${
                            nested === 1 ? "" : "s"
                          })`
                        : ""
                    }`;
                  })()}
            </p>
          </div>

          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {isOwnerUser && (
              <span className="mt-1 block text-green-400">
                ✓ You are the owner — files are added directly (no PR needed)
              </span>
            )}
            {isOwnerUser === false && (
              <span className="mt-1 block text-yellow-400">
                ⚠ You are not the owner — files will require a Pull Request
              </span>
            )}
          </p>
        </div>

        {staged.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold">Selected ({staged.length}):</h3>
              <button
                type="button"
                onClick={() => setStaged([])}
                className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)]"
              >
                Clear
              </button>
            </div>
            <ul className="max-h-64 list-inside list-disc space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-dark)] p-3">
              {staged.map((item) => (
                <li
                  key={item.path}
                  className="font-mono text-sm text-[var(--color-text-secondary)]"
                >
                  {item.path}{" "}
                  <span className="font-sans text-xs opacity-70">
                    ({(item.file.size / 1024).toFixed(2)} KB)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUpload}
            disabled={!canUpload}
            className={
              canUpload
                ? "theme-bg-accent-primary rounded-md px-4 py-2 font-medium text-white"
                : "cursor-not-allowed rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2 font-medium text-[var(--color-text-secondary)]"
            }
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
          <Link
            href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </Link>
        </div>

        {status && (
          <div
            className={`rounded-md p-3 ${
              status.includes("Error") ? "bg-red-900/80" : "bg-green-900/80"
            }`}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

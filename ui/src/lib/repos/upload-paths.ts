import { normalizeFilePath } from "@/lib/repos/storage";

export type StagedUploadFile = { file: File; path: string };

/** Prefer folder-relative path from the browser when present. */
export function pathFromUploadFile(file: File): string {
  const rel = file.webkitRelativePath?.trim();
  return normalizeFilePath(rel && rel.length > 0 ? rel : file.name);
}

/** Merge by path (later wins), sorted for stable UI. */
export function mergeStagedUploads(
  prev: StagedUploadFile[],
  incoming: StagedUploadFile[]
): StagedUploadFile[] {
  const map = new Map<string, StagedUploadFile>();
  for (const item of prev) map.set(item.path, item);
  for (const item of incoming) {
    if (!item.path) continue;
    map.set(item.path, item);
  }
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

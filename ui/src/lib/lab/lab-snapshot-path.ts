/**
 * Server-owned lab dashboard HTML snapshot.
 * Production path: /opt/ngit/data/lab-snapshot/index.html
 * Deploy must never wipe this directory from a laptop.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveLabSnapshotHtmlPath(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.GITTR_LAB_SNAPSHOT_PATH?.trim()) {
    return process.env.GITTR_LAB_SNAPSHOT_PATH.trim();
  }
  const cwd = process.cwd();
  return /[/\\]ui$/.test(cwd)
    ? join(cwd, "..", "data", "lab-snapshot", "index.html")
    : join(cwd, "data", "lab-snapshot", "index.html");
}

export function labSnapshotExists(
  path = resolveLabSnapshotHtmlPath()
): boolean {
  return existsSync(path);
}

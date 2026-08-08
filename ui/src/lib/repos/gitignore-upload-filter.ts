import type { StagedUploadFile } from "@/lib/repos/upload-paths";

/**
 * Respect .gitignore on folder uploads: files matched by .gitignore rules in
 * the uploaded tree are skipped before staging (node_modules, .env, dist, …),
 * and .git/ internals are always skipped. This mirrors what `git add` would
 * do, so a drag & dropped working copy never leaks ignored files or secrets.
 *
 * Supported gitignore syntax (the practical subset):
 * comments/blank lines, `!` negation (last match wins), trailing `/` for
 * directories, leading `/` anchoring, `*`, `?`, `**`, nested .gitignore files
 * scoped to their directory. Re-including inside an ignored directory is not
 * supported (matches git's own limitation).
 */

type IgnoreRule = {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
};

function globToRegExpSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**` crosses directory boundaries
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Parse one .gitignore body; `baseDir` scopes nested files ("" for root). */
export function parseGitignoreRules(
  content: string,
  baseDir: string
): IgnoreRule[] {
  const prefix = baseDir ? `${baseDir.replace(/\/+$/, "")}/` : "";
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    // Trailing spaces are ignored unless escaped; we skip the escape nuance.
    let line = rawLine.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (!line) continue;
    // Leading or inner slash anchors to the .gitignore's directory;
    // otherwise the pattern matches at any depth below it.
    const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
    const body = globToRegExpSource(line.replace(/^\/+/, ""));
    const source = anchored
      ? `^${prefix}${body}$`
      : `^${prefix}(?:.*/)?${body}$`;
    try {
      rules.push({ regex: new RegExp(source), negated, dirOnly });
    } catch {
      /* skip malformed pattern */
    }
  }
  return rules;
}

/** True when `path` (repo-relative, no leading slash) is gitignored. */
export function isPathGitignored(path: string, rules: IgnoreRule[]): boolean {
  const clean = path.replace(/^\/+/, "");
  if (!clean) return false;
  // The path itself plus every ancestor directory: a rule matching an
  // ancestor dir ignores everything below it.
  const candidates: Array<{ target: string; isDir: boolean }> = [];
  const segments = clean.split("/");
  for (let i = 1; i < segments.length; i++) {
    candidates.push({ target: segments.slice(0, i).join("/"), isDir: true });
  }
  candidates.push({ target: clean, isDir: false });

  for (const { target, isDir } of candidates) {
    let verdict: boolean | null = null;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(target)) verdict = !rule.negated;
    }
    if (verdict === true) return true;
  }
  return false;
}

export function isGitInternalPath(path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  return clean === ".git" || clean.startsWith(".git/") || clean.includes("/.git/");
}

export type GitignoreSplitResult = {
  kept: StagedUploadFile[];
  skipped: StagedUploadFile[];
};

/**
 * Split staged uploads into kept / skipped using the .gitignore files present
 * in the staged set itself. `.gitignore` files are always kept (git tracks
 * them); `.git/` internals are always skipped.
 */
export async function splitStagedUploadsByGitignore(
  staged: StagedUploadFile[]
): Promise<GitignoreSplitResult> {
  const gitignoreEntries = staged.filter(({ path }) => {
    const base = path.split("/").pop();
    return base === ".gitignore" && !isGitInternalPath(path);
  });

  const rules: IgnoreRule[] = [];
  for (const entry of gitignoreEntries) {
    try {
      const content = await entry.file.text();
      const dir = entry.path.includes("/")
        ? entry.path.slice(0, entry.path.lastIndexOf("/"))
        : "";
      rules.push(...parseGitignoreRules(content, dir));
    } catch {
      /* unreadable .gitignore — ignore it */
    }
  }

  const kept: StagedUploadFile[] = [];
  const skipped: StagedUploadFile[] = [];
  for (const item of staged) {
    if (isGitInternalPath(item.path)) {
      skipped.push(item);
      continue;
    }
    const base = item.path.split("/").pop();
    if (base === ".gitignore") {
      kept.push(item);
      continue;
    }
    if (rules.length > 0 && isPathGitignored(item.path, rules)) {
      skipped.push(item);
    } else {
      kept.push(item);
    }
  }
  return { kept, skipped };
}

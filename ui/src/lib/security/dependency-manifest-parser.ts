/**
 * Parse package manifests / lockfiles into concrete package references we can
 * query against OSV.dev. Unlike dependency-parser.ts (which builds a
 * file-to-file import graph), this extracts *third-party packages + versions*
 * so we can check them for known vulnerabilities.
 *
 * `precision` tells the caller how trustworthy the version is:
 *  - "pinned":   exact version from a lockfile or `==` pin (DM-worthy)
 *  - "range-min": lower bound of a semver range in package.json etc. (badge only)
 */

export type OsvEcosystem =
  | "npm"
  | "PyPI"
  | "Go"
  | "crates.io"
  | "RubyGems"
  | "Packagist"
  | "Maven";

export type VersionPrecision = "pinned" | "range-min";

export interface ManifestPackage {
  ecosystem: OsvEcosystem;
  name: string;
  version: string;
  direct: boolean;
  precision: VersionPrecision;
  sourceFile: string;
}

/** Manifest filenames we know how to read (basename, case-insensitive). */
export const MANIFEST_FILENAMES: readonly string[] = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "requirements.txt",
  "go.mod",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
];

export function isManifestPath(path: string): boolean {
  const base = (path.split("/").pop() || "").toLowerCase();
  return MANIFEST_FILENAMES.includes(base);
}

/** Strip a semver range to its lowest concrete x.y.z (best-effort). */
function rangeMinVersion(raw: string): string | null {
  const t = raw.trim();
  if (!t || t === "*" || t === "latest") return null;
  // git/url/file/workspace specifiers can't be version-matched
  if (/[:/@]/.test(t) && !/^[\^~>=<v ]*\d/.test(t)) return null;
  const m = t.match(/(\d+)\.(\d+)\.(\d+)/) || t.match(/(\d+)\.(\d+)/);
  if (!m) return null;
  if (m.length >= 4) return `${m[1]}.${m[2]}.${m[3]}`;
  return `${m[1]}.${m[2]}.0`;
}

function pushUnique(out: ManifestPackage[], pkg: ManifestPackage): void {
  const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version}`;
  if (!out.some((p) => `${p.ecosystem}|${p.name}|${p.version}` === key)) {
    out.push(pkg);
  }
}

function parsePackageJson(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  let json: any;
  try {
    json = JSON.parse(content);
  } catch {
    return out;
  }
  const sections = ["dependencies", "devDependencies", "optionalDependencies"];
  for (const section of sections) {
    const deps = json?.[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, rangeRaw] of Object.entries(deps)) {
      if (typeof rangeRaw !== "string") continue;
      const version = rangeMinVersion(rangeRaw);
      if (!version) continue;
      pushUnique(out, {
        ecosystem: "npm",
        name,
        version,
        direct: true,
        precision: "range-min",
        sourceFile: file,
      });
    }
  }
  return out;
}

function parsePackageLock(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  let json: any;
  try {
    json = JSON.parse(content);
  } catch {
    return out;
  }
  // npm v7+ lockfile: { packages: { "node_modules/foo": { version } } }
  if (json?.packages && typeof json.packages === "object") {
    for (const [path, meta] of Object.entries<any>(json.packages)) {
      if (!path || !meta?.version) continue;
      const name = path.replace(/^.*node_modules\//, "");
      if (!name) continue;
      pushUnique(out, {
        ecosystem: "npm",
        name,
        version: String(meta.version),
        direct: !path.includes("node_modules/", 1),
        precision: "pinned",
        sourceFile: file,
      });
    }
    return out;
  }
  // npm v6 lockfile: { dependencies: { foo: { version, dependencies } } }
  const walk = (deps: any) => {
    if (!deps || typeof deps !== "object") return;
    for (const [name, meta] of Object.entries<any>(deps)) {
      if (meta?.version) {
        pushUnique(out, {
          ecosystem: "npm",
          name,
          version: String(meta.version),
          direct: false,
          precision: "pinned",
          sourceFile: file,
        });
      }
      if (meta?.dependencies) walk(meta.dependencies);
    }
  };
  walk(json?.dependencies);
  return out;
}

function parseYarnLock(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  // Blocks like:  "lodash@^4.17.0":\n  version "4.17.21"
  const blocks = content.split(/\n(?=\S)/);
  for (const block of blocks) {
    const header = block.split("\n")[0] || "";
    const versionMatch = block.match(/\n\s+version:?\s+"?([^"\n]+)"?/);
    if (!versionMatch) continue;
    const version = versionMatch[1]!.trim();
    // Header is comma-separated specifiers: `"foo@^1", "foo@~1.2":`
    const first = header.split(",")[0]!.trim().replace(/:$/, "").replace(/^"|"$/g, "");
    // strip trailing @range → package name (handle @scope/name@range)
    const at = first.lastIndexOf("@");
    const name = at > 0 ? first.slice(0, at) : first;
    if (!name) continue;
    pushUnique(out, {
      ecosystem: "npm",
      name,
      version,
      direct: false,
      precision: "pinned",
      sourceFile: file,
    });
  }
  return out;
}

function parseRequirementsTxt(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line || line.startsWith("-")) continue;
    // Only exact pins are reliable: `name==1.2.3`
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*==\s*([A-Za-z0-9_.+-]+)/);
    if (!m) continue;
    pushUnique(out, {
      ecosystem: "PyPI",
      name: m[1]!.toLowerCase(),
      version: m[2]!,
      direct: true,
      precision: "pinned",
      sourceFile: file,
    });
  }
  return out;
}

function parseGoMod(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  const requireRe = /^\s*(?:require\s+)?([\w./-]+\.[\w./-]+)\s+v(\d+\.\d+\.\d+[\w.+-]*)/;
  let inBlock = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    if (line.includes("// indirect") && !line.startsWith("require")) {
      // still parse, but mark indirect
    }
    const m = line.match(requireRe);
    if (!m) continue;
    pushUnique(out, {
      ecosystem: "Go",
      name: m[1]!,
      version: m[2]!,
      direct: !line.includes("// indirect"),
      precision: "pinned",
      sourceFile: file,
    });
  }
  return out;
}

function parseCargoLock(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  // TOML [[package]] blocks with name/version lines
  const blocks = content.split(/\[\[package\]\]/);
  for (const block of blocks) {
    const name = block.match(/\bname\s*=\s*"([^"]+)"/)?.[1];
    const version = block.match(/\bversion\s*=\s*"([^"]+)"/)?.[1];
    if (!name || !version) continue;
    pushUnique(out, {
      ecosystem: "crates.io",
      name,
      version,
      direct: false,
      precision: "pinned",
      sourceFile: file,
    });
  }
  return out;
}

function parseGemfileLock(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  // GEM specs section:  `    rails (7.0.4)`
  let inSpecs = false;
  for (const rawLine of content.split(/\r?\n/)) {
    if (/^\s{2}specs:/.test(rawLine)) {
      inSpecs = true;
      continue;
    }
    if (inSpecs && /^\S/.test(rawLine)) inSpecs = false;
    if (!inSpecs) continue;
    const m = rawLine.match(/^\s{4}([A-Za-z0-9_.-]+)\s+\(([^)]+)\)/);
    if (!m) continue;
    pushUnique(out, {
      ecosystem: "RubyGems",
      name: m[1]!,
      version: m[2]!,
      direct: false,
      precision: "pinned",
      sourceFile: file,
    });
  }
  return out;
}

function parseComposerLock(content: string, file: string): ManifestPackage[] {
  const out: ManifestPackage[] = [];
  let json: any;
  try {
    json = JSON.parse(content);
  } catch {
    return out;
  }
  for (const section of ["packages", "packages-dev"]) {
    const arr = json?.[section];
    if (!Array.isArray(arr)) continue;
    for (const pkg of arr) {
      if (!pkg?.name || !pkg?.version) continue;
      pushUnique(out, {
        ecosystem: "Packagist",
        name: String(pkg.name),
        version: String(pkg.version).replace(/^v/, ""),
        direct: section === "packages",
        precision: "pinned",
        sourceFile: file,
      });
    }
  }
  return out;
}

/** Parse a single manifest file by its path + content. */
export function parseManifest(path: string, content: string): ManifestPackage[] {
  const base = (path.split("/").pop() || "").toLowerCase();
  switch (base) {
    case "package.json":
      return parsePackageJson(content, path);
    case "package-lock.json":
      return parsePackageLock(content, path);
    case "yarn.lock":
      return parseYarnLock(content, path);
    case "requirements.txt":
      return parseRequirementsTxt(content, path);
    case "go.mod":
      return parseGoMod(content, path);
    case "cargo.lock":
      return parseCargoLock(content, path);
    case "gemfile.lock":
      return parseGemfileLock(content, path);
    case "composer.lock":
      return parseComposerLock(content, path);
    default:
      return [];
  }
}

/**
 * Merge packages from several manifests. When the same package appears from a
 * lockfile (pinned) and package.json (range-min), keep the pinned one.
 */
export function mergeManifestPackages(
  groups: ManifestPackage[][]
): ManifestPackage[] {
  const byPkg = new Map<string, ManifestPackage>();
  for (const group of groups) {
    for (const pkg of group) {
      const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version}`;
      const prev = byPkg.get(key);
      if (!prev) {
        byPkg.set(key, pkg);
        continue;
      }
      // Prefer pinned precision and direct=true when duplicated
      byPkg.set(key, {
        ...prev,
        direct: prev.direct || pkg.direct,
        precision:
          prev.precision === "pinned" || pkg.precision === "pinned"
            ? "pinned"
            : "range-min",
      });
    }
  }
  return Array.from(byPkg.values());
}

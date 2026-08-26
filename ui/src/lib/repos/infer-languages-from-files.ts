/** Map a filename to a language label (extension-based; no linguist/cloc). */
const EXT_TO_LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  rb: "Ruby",
  php: "PHP",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  hh: "C++",
  cs: "C#",
  scala: "Scala",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  yaml: "YAML",
  yml: "YAML",
  json: "JSON",
  toml: "TOML",
  md: "Markdown",
  sql: "SQL",
};

export function languageFromFilename(filename: string): string {
  const name = filename.split("/").pop() || filename;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!ext) return "Other";
  return EXT_TO_LANG[ext] || ext.toUpperCase();
}

export function inferLanguagesFromFiles(
  files: Array<{ path?: string; type?: string; size?: number }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of files) {
    if (f.type && f.type !== "file") continue;
    const path = typeof f.path === "string" ? f.path : "";
    if (!path) continue;
    const lang = languageFromFilename(path);
    counts[lang] =
      (counts[lang] || 0) + (typeof f.size === "number" ? f.size : 1);
  }
  return counts;
}

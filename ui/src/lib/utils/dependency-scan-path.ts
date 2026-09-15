const DEPENDENCY_CODE_FILE_RE =
  /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx|py|pyw|go|rs|java|php|rb|vue|svelte)$/i;

const SKIP_DIR_RE =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|out|vendor)(\/|$)/i;

const TEST_FILE_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i;

/** Source files worth scanning for import graphs — skip tests and vendor trees. */
export function shouldScanDependencySourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!DEPENDENCY_CODE_FILE_RE.test(normalized)) return false;
  if (SKIP_DIR_RE.test(normalized)) return false;
  if (/(^|\/)__tests__\//.test(normalized)) return false;
  if (TEST_FILE_RE.test(normalized)) return false;
  return true;
}

export { DEPENDENCY_CODE_FILE_RE };

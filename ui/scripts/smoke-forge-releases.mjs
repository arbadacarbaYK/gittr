/**
 * Smoke-test forge release resolution (no Next server required).
 * Run from ui/: node scripts/smoke-forge-releases.mjs
 */
import { createHash } from "crypto";

// Inline the pure helpers (avoid TS import). Keep in sync with forge-releases.ts.
function isApkAssetName(name, contentType) {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".apk")) return true;
  const ct = (contentType || "").toLowerCase();
  return (
    ct === "application/vnd.android.package-archive" ||
    ct.includes("android.package")
  );
}

function resolveForgeFromSourceUrl(sourceUrl) {
  if (!sourceUrl || !String(sourceUrl).trim()) {
    return { ok: false, code: "missing_source" };
  }
  let u = String(sourceUrl).trim();
  const ssh = u.match(/^git@([^:]+):(.+)$/);
  if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
  else if (u.startsWith("git://")) u = u.replace(/^git:\/\//, "https://");
  else if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const parsed = new URL(u.replace(/\.git$/i, ""));
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return { ok: false, code: "unsupported_forge" };
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  let forge = null;
  if (host.includes("github.com")) forge = "github";
  else if (host.includes("codeberg.org")) forge = "codeberg";
  else if (host.includes("gitlab.com")) forge = "gitlab";
  if (!forge) return { ok: false, code: "unsupported_forge" };
  return { ok: true, forge, owner, repo };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchGitHub(owner, repo) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gittr-smoke-forge-releases",
  };
  if (process.env.GITHUB_PLATFORM_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_PLATFORM_TOKEN}`;
  }
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

async function main() {
  // Unit-ish checks
  assert(
    resolveForgeFromSourceUrl("").ok === false,
    "empty source should fail"
  );
  assert(
    resolveForgeFromSourceUrl("https://github.com/foo/bar.git").ok === true,
    "github should parse"
  );
  assert(isApkAssetName("app-release.apk"), "apk name");
  assert(!isApkAssetName("source.zip"), "zip is not apk");

  // Live: repo with no releases → expect empty list (bitcoin/bips has releases though)
  // Use a tiny known public repo — octocat/Hello-World typically has no releases/APKs
  const none = resolveForgeFromSourceUrl(
    "https://github.com/octocat/Hello-World"
  );
  assert(none.ok, "hello-world parse");
  const list = await fetchGitHub(none.owner, none.repo);
  const withApk = (Array.isArray(list) ? list : []).find((r) =>
    (r.assets || []).some((a) => isApkAssetName(a.name, a.content_type))
  );
  if (withApk) {
    console.log(
      "note: octocat/Hello-World unexpectedly has an APK release; skip no-apk assert"
    );
  } else {
    console.log("ok: no APK on octocat/Hello-World (expected for announce error path)");
  }

  // Live: known Android app with GitHub Releases + APK (Zapstore client)
  const zs = resolveForgeFromSourceUrl("https://github.com/zapstore/zapstore");
  assert(zs.ok, "zapstore parse");
  const zsList = await fetchGitHub(zs.owner, zs.repo);
  const zsRel = (Array.isArray(zsList) ? zsList : []).find(
    (r) => !r.draft && (r.assets || []).some((a) => isApkAssetName(a.name))
  );
  assert(zsRel, "zapstore/zapstore should have a release with APK");
  const apk = zsRel.assets.find((a) => isApkAssetName(a.name));
  assert(apk?.browser_download_url, "apk download url");
  console.log(
    `ok: zapstore ${zsRel.tag_name} APK ${apk.name} (${apk.size} bytes)`
  );

  // Hash first ~1MB only as a smoke of download (full hash can be large)
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(apk.browser_download_url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "gittr-smoke-forge-releases", Range: "bytes=0-1023" },
    });
    assert(r.ok || r.status === 206, `download status ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert(buf.length > 0, "got bytes");
    const h = createHash("sha256").update(buf).digest("hex");
    console.log(`ok: ranged download hash prefix ${h.slice(0, 12)}…`);
  } finally {
    clearTimeout(t);
  }

  console.log("smoke-forge-releases: all checks passed");
}

main().catch((e) => {
  console.error("smoke-forge-releases FAILED:", e);
  process.exit(1);
});

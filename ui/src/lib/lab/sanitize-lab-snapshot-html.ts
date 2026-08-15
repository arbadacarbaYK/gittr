/**
 * Harden scrubbed lab-dashboard HTML before public serve / iframe preview.
 *
 * Display-only snapshot with an offline canvas map:
 * - Keep inline scripts + JSON data islands (map needs them).
 * - Strip external script src, iframes, objects, embeds, inline handlers.
 * - Neutralize private/local URLs in href/src.
 * - CSP allows inline scripts but blocks network (connect-src 'none').
 * - Inject height reporter so /lab can grow the iframe (sandbox has no
 *   allow-same-origin, so the parent cannot read scrollHeight directly).
 * Pair with iframe sandbox="allow-scripts" (no allow-same-origin).
 */

const PRIVATE_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0x[0-9a-f]+)$/i;

/** postMessage type from injected reporter → LabDashboardClient */
export const LAB_SNAPSHOT_HEIGHT_MESSAGE = "gittr-lab-snapshot-height" as const;

/**
 * Pointer/wheel over the connection-map canvas. Parent locks page scroll so
 * wheel zooms the map instead of scrolling the tall auto-sized iframe page.
 */
export const LAB_SNAPSHOT_MAP_INTERACT_MESSAGE =
  "gittr-lab-map-interact" as const;

/** Response + meta CSP for /api/lab/snapshot (keep in sync). */
export const LAB_SNAPSHOT_CSP =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' data:; font-src data: https:; media-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

function isPrivateOrLocalUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.startsWith("#") || value.startsWith("mailto:")) {
    return false;
  }
  if (/^\s*javascript:/i.test(value) || /^\s*data:/i.test(value)) {
    return true;
  }
  try {
    const base = "https://gittr.space/";
    const u = new URL(value, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return true;
    }
    // Relative site paths are fine (same public origin when resolved oddly).
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//")) {
      return false;
    }
    return PRIVATE_HOST_RE.test(u.hostname);
  } catch {
    return true;
  }
}

function neutralizePrivateUrls(html: string): string {
  return html.replace(
    /\b(href|src|action|formaction|poster|data|xlink:href)\s*=\s*(["'])([\s\S]*?)\2/gi,
    (full, attr: string, quote: string, url: string) => {
      if (!isPrivateOrLocalUrl(url)) return full;
      return `${attr}=${quote}#blocked-local${quote}`;
    }
  );
}

/**
 * Drop only scripts that load over the network (`src=`).
 * Keep inline JS and `type="application/json"` data islands for the map.
 */
function stripExternalScripts(html: string): string {
  return html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs: string) => {
      if (/\bsrc\s*=/i.test(attrs)) {
        return "";
      }
      return full;
    }
  );
}

/**
 * Auto-height + map wheel bridge for sandboxed iframe (origin is typically "null").
 * - Fixed graph height (no 88vh against a multi-thousand-px iframe).
 * - Debounced height posts only (no ResizeObserver loop → map fitCamera spam).
 * - Tell parent when the canvas is hovered so page scroll does not eat zoom.
 */
function injectAutoHeightReporter(html: string): string {
  const heightType = JSON.stringify(LAB_SNAPSHOT_HEIGHT_MESSAGE);
  const interactType = JSON.stringify(LAB_SNAPSHOT_MAP_INTERACT_MESSAGE);
  const style = `<style id="gittr-lab-autoheight">html,body{height:auto!important;min-height:0!important;overflow:visible!important;}#gwrap.graph-wrap,.graph-wrap#gwrap{height:1100px!important;max-height:1100px!important;min-height:640px!important;}</style>`;
  const script = `<script id="gittr-lab-autoheight-script">(function(){var lastH=0,mapActive=false;function h(){try{var d=document.documentElement,b=document.body;return Math.max(d?d.scrollHeight:0,d?d.offsetHeight:0,b?b.scrollHeight:0,b?b.offsetHeight:0)}catch(e){return 0}}function report(){if(mapActive)return;var n=h();if(n<1)return;if(Math.abs(n-lastH)<4)return;lastH=n;try{parent.postMessage({type:${heightType},height:n},"*")}catch(e){}}function setMap(active){mapActive=!!active;try{parent.postMessage({type:${interactType},active:mapActive},"*")}catch(e){}}function bindMap(){var canvas=document.getElementById("graph");if(!canvas)return false;canvas.addEventListener("pointerenter",function(){setMap(true)});canvas.addEventListener("pointerleave",function(){setMap(false)});canvas.addEventListener("wheel",function(){setMap(true)},{passive:true,capture:true});return true}report();window.addEventListener("load",function(){report();bindMap()||setTimeout(bindMap,500)});[400,1200,3000,7000].forEach(function(ms){setTimeout(function(){report();bindMap()},ms)});})();</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${style}\n${script}\n</body>`);
  }
  return `${html}\n${style}\n${script}`;
}

/** Strip active network content + block private-network targets; keep map JS. */
export function sanitizeLabSnapshotHtml(input: string): string {
  let html = String(input || "");

  html = stripExternalScripts(html);
  html = html.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");
  html = html.replace(/<iframe\b[^>]*>/gi, "");
  html = html.replace(/<object\b[\s\S]*?<\/object>/gi, "");
  html = html.replace(/<embed\b[^>]*>/gi, "");
  html = html.replace(/<applet\b[\s\S]*?<\/applet>/gi, "");
  html = html.replace(
    /<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1[^>]*>/gi,
    ""
  );
  html = html.replace(/<base\b[^>]*>/gi, "");
  // Inline handlers: onclick=, onerror=, …
  html = html.replace(/\son[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  html = neutralizePrivateUrls(html);

  // Replace any existing CSP meta so we don't leave a stale script-src 'none'.
  html = html.replace(
    /<meta\b[^>]*http-equiv\s*=\s*(["']?)Content-Security-Policy\1[^>]*>/gi,
    ""
  );

  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(
      /<head\b[^>]*>/i,
      (m) =>
        `${m}\n<meta http-equiv="Content-Security-Policy" content="${LAB_SNAPSHOT_CSP}">`
    );
  } else {
    html = `<meta http-equiv="Content-Security-Policy" content="${LAB_SNAPSHOT_CSP}">\n${html}`;
  }

  return injectAutoHeightReporter(html);
}

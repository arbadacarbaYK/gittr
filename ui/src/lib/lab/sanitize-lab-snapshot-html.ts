/**
 * Harden scrubbed lab-dashboard HTML before public serve / iframe preview.
 * Goal: display-only snapshot — no scripts, no reach into private/local nets.
 */

const PRIVATE_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0x[0-9a-f]+)$/i;

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

/** Strip active content + block private-network targets. */
export function sanitizeLabSnapshotHtml(input: string): string {
  let html = String(input || "");

  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script\b[^>]*>/gi, "");
  html = html.replace(/<\/script>/gi, "");
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

  const csp =
    "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' data:; font-src data: https:; media-src 'none'; connect-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

  if (!/http-equiv\s*=\s*["']?Content-Security-Policy/i.test(html)) {
    if (/<head\b[^>]*>/i.test(html)) {
      html = html.replace(
        /<head\b[^>]*>/i,
        (m) =>
          `${m}\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
      );
    } else {
      html = `<meta http-equiv="Content-Security-Policy" content="${csp}">\n${html}`;
    }
  }

  return html;
}

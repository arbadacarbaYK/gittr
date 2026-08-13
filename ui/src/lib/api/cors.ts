/**
 * CORS headers for GRASP protocol compliance
 * GRASP requires: Access-Control-Allow-Origin: *, Access-Control-Allow-Methods: GET, POST, Access-Control-Allow-Headers: Content-Type
 */

export function setCorsHeaders(res: any, _req?: any): void {
  // Set CORS headers for GRASP protocol compliance
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Also set standard security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

export function handleOptionsRequest(res: any, _req?: any): void {
  setCorsHeaders(res, _req);
  res.status(204).end(); // 204 No Content for OPTIONS requests (GRASP requirement)
}

/**
 * Restrictive CORS for payment / wallet APIs (zap, bounty). Same-origin UI
 * does not need *, and open CORS + wallet keys is dangerous.
 */
export function setPaymentCorsHeaders(res: any, req?: any): void {
  const site =
    process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const origin =
    typeof req?.headers?.origin === "string" ? req.headers.origin : "";
  let allow = "";
  try {
    if (site && origin) {
      const siteHost = new URL(site).host;
      const originHost = new URL(origin).host;
      if (siteHost && originHost && siteHost === originHost) {
        allow = origin;
      }
    }
  } catch {
    /* ignore */
  }
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

export function handlePaymentOptionsRequest(res: any, req?: any): void {
  setPaymentCorsHeaders(res, req);
  res.status(204).end();
}

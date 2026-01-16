/**
 * CORS headers for GRASP protocol compliance
 * GRASP requires: Access-Control-Allow-Origin: *, Access-Control-Allow-Methods: GET, POST, Access-Control-Allow-Headers: Content-Type
 */

export function setCorsHeaders(res: any): void {
  // Set CORS headers for GRASP protocol compliance
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Also set standard security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

export function handleOptionsRequest(res: any): void {
  setCorsHeaders(res);
  res.status(204).end(); // 204 No Content for OPTIONS requests (GRASP requirement)
}

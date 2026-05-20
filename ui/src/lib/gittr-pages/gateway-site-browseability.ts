import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

/**
 * Directory listings should only include sites that serve `/` (manifest has `/index.html`).
 * When `hasIndexHtml` is missing (legacy gateway JSON), keep the row until the gateway is redeployed.
 */
export function filterBrowsableGatewaySites(
  sites: GatewayStatusSiteRow[]
): GatewayStatusSiteRow[] {
  return sites.filter((s) => s.hasIndexHtml !== false);
}

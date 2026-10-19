/**
 * The public test route can send with the server bot token and Nostr key.
 * It stays off unless a developer opts in, and it never opens in production.
 */
export function notificationTestEndpointEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NOTIFICATIONS_TEST_ENABLED === "1"
  );
}

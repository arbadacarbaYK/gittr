/**
 * `ws` is a server-only dependency used to store a Pages manifest on
 * relay.gittr.space. It ships no types that this tsconfig resolves.
 * Typecheck only — do not map this file in tsconfig paths.
 */
declare module "ws" {
  export class WebSocket {
    constructor(url: string);
    send(data: string): void;
    close(): void;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: { data: unknown }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
  }
  export default WebSocket;
}

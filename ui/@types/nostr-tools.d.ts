/**
 * nostr-tools 1.7.x ships types at lib/index.d.ts, but package.json "exports"
 * has no "types" condition. Next 16 / bundler resolution then treats the ESM
 * file as untyped.
 *
 * Do NOT add a tsconfig "paths" mapping to that .d.ts — Turbopack follows
 * paths for runtime and would bundle a types-only module (nip19.decode
 * undefined). Keep this ambient file for typecheck only.
 */
declare module "nostr-tools" {
  export type Event = {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  };
  export type UnsignedEvent = {
    kind: number;
    tags: string[][];
    content: string;
    created_at: number;
    pubkey: string;
    id?: string;
    sig?: string;
  };
  export type Filter = {
    ids?: string[];
    kinds?: number[];
    authors?: string[];
    since?: number;
    until?: number;
    limit?: number;
    search?: string;
    [key: string]: unknown;
  };

  export const nip04: {
    encrypt(
      privkey: string,
      pubkey: string,
      text: string
    ): Promise<string> | string;
    decrypt(
      privkey: string,
      pubkey: string,
      data: string
    ): Promise<string> | string;
  };
  export const nip05: {
    queryProfile(
      fullname: string
    ): Promise<{ pubkey: string; relays?: string[] } | null>;
  };
  export const nip19: {
    decode(nip19: string): { type: string; data: unknown };
    npubEncode(hex: string): string;
    nsecEncode(hex: string): string;
    noteEncode(hex: string): string;
    nprofileEncode(profile: { pubkey: string; relays?: string[] }): string;
    neventEncode(event: {
      id: string;
      relays?: string[];
      author?: string;
    }): string;
    naddrEncode(addr: {
      identifier: string;
      pubkey: string;
      kind: number;
      relays?: string[];
    }): string;
  };

  export function getPublicKey(privateKey: string): string;
  export function generatePrivateKey(): string;
  export function getEventHash(event: UnsignedEvent): string;
  export function signEvent(event: UnsignedEvent, key: string): string;
  export function finishEvent(event: UnsignedEvent, privateKey: string): Event;
  export function verifySignature(event: Event): boolean;
  export function validateEvent(event: UnsignedEvent): boolean;

  export class SimplePool {
    constructor(options?: { eoseSubTimeout?: number; getTimeout?: number });
    [key: string]: any;
  }
}

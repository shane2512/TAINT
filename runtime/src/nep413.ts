// NEP-413: a wallet signs an arbitrary message to prove its account's key made a request. Used so only the owner of a
// TAINT account can make the agent act for it: a payment the agent proposes is taken from that owner's balance.
import { createHash } from "node:crypto";
import { PublicKey } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { serialize } from "borsh";

const TAG = 2 ** 31 + 413;

export interface SignedMessage {
  accountId: string;
  /** "ed25519:..." */
  publicKey: string;
  /** base64 */
  signature: string;
  message: string;
  /** base64 of 32 random bytes */
  nonce: string;
  recipient: string;
}

const schema = {
  struct: { tag: "u32", message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } },
} as const;

export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl: string | null = null): Buffer {
  const bytes = serialize(schema, { tag: TAG, message, nonce: Array.from(nonce), recipient, callbackUrl });
  return createHash("sha256").update(bytes).digest();
}

/** Does `accountId` have this key with full access on the real network? */
export type KeyCheck = (accountId: string, publicKey: string) => Promise<boolean>;

export function rpcKeyCheck(rpcUrl: string): KeyCheck {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  return async (accountId, publicKey) => {
    try {
      const res: any = await provider.query({ request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
      return res?.permission === "FullAccess";
    } catch {
      return false;
    }
  };
}

/** Nonces already used, so a captured signed request cannot be replayed. */
export class NonceBook {
  private seen = new Map<string, number>();
  constructor(private ttlMs = 10 * 60_000, private now: () => number = Date.now) {}
  /** True the first time; false for a repeat. */
  take(nonce: string): boolean {
    const t = this.now();
    for (const [k, at] of this.seen) if (t - at > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, t);
    return true;
  }
}

export interface Verified {
  ok: boolean;
  why?: string;
}

/**
 * The signature is valid for exactly this message, nonce and recipient; the key belongs to the account with full access;
 * and the nonce has not been seen. `expectMessage` is what the server itself derives from the request, so the owner
 * signed this very instruction and not some other text.
 */
export async function verifyNep413(m: SignedMessage, o: { recipient: string; expectMessage: string; keyCheck: KeyCheck; nonces: NonceBook }): Promise<Verified> {
  if (m.recipient !== o.recipient) return { ok: false, why: "signed for a different recipient" };
  if (m.message !== o.expectMessage) return { ok: false, why: "signed message is not this request" };
  let nonce: Buffer;
  try {
    nonce = Buffer.from(m.nonce, "base64");
  } catch {
    return { ok: false, why: "bad nonce" };
  }
  if (nonce.length !== 32) return { ok: false, why: "nonce must be 32 bytes" };
  try {
    const good = PublicKey.fromString(m.publicKey).verify(nep413Hash(m.message, nonce, m.recipient), Buffer.from(m.signature, "base64"));
    if (!good) return { ok: false, why: "signature does not match" };
  } catch {
    return { ok: false, why: "signature unreadable" };
  }
  if (!(await o.keyCheck(m.accountId, m.publicKey))) return { ok: false, why: "that key is not a full-access key of the account" };
  if (!o.nonces.take(m.nonce)) return { ok: false, why: "this signed request was already used" };
  return { ok: true };
}

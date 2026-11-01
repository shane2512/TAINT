import { createHash, randomUUID } from "node:crypto";
import { KeyPair, PublicKey } from "@near-js/crypto";

export interface Attachment {
  source: string;
  text: string;
}

export interface SignedOwnerMessage {
  instruction: string;
  attachments: Attachment[];
  nonce: string;
  publicKey: string;
  signature: string;
}

const MAX_INSTRUCTION = 280;

function digest(instruction: string, attachments: Attachment[], nonce: string): Buffer {
  // explicit key order so the signed bytes do not depend on how a client built its objects
  const canonical = { instruction, attachments: attachments.map((a) => ({ source: a.source, text: a.text })), nonce };
  return createHash("sha256").update(JSON.stringify(canonical)).digest();
}

export function signOwnerMessage(
  instruction: string,
  attachments: Attachment[],
  keyPair: KeyPair,
  nonce: string = randomUUID(),
): SignedOwnerMessage {
  if (instruction.length > MAX_INSTRUCTION) throw new Error("instruction over 280 chars");
  const { signature, publicKey } = keyPair.sign(digest(instruction, attachments, nonce));
  return {
    instruction,
    attachments,
    nonce,
    publicKey: publicKey.toString(),
    signature: Buffer.from(signature).toString("base64"),
  };
}

export function verifyOwnerMessage(m: SignedOwnerMessage, ownerPublicKey: string): boolean {
  if (m.publicKey !== ownerPublicKey) return false;
  if (m.instruction.length > MAX_INSTRUCTION) return false;
  try {
    return PublicKey.fromString(ownerPublicKey).verify(
      digest(m.instruction, m.attachments, m.nonce),
      Buffer.from(m.signature, "base64"),
    );
  } catch {
    return false;
  }
}

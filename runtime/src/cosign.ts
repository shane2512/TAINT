// The owner's one-tap approval: a NEP-366 delegate action carrying a single `cosign` call. The owner signs it
// off-chain; a relayer wraps it in a transaction and pays the gas. On chain the call runs with the owner as the
// predecessor, so the contract's owner-only check passes without the owner holding gas or sending a transaction.
import type { Account } from "@near-js/accounts";
import { SCHEMA, SignedDelegate, actionCreators, encodeSignedDelegate } from "@near-js/transactions";
import { deserialize } from "borsh";

const GAS = 100_000_000_000_000n; // 100 Tgas

/** Sign a delegate action approving one held proposal. It expires `blockHeightTtl` blocks after the current block. */
export async function buildCosignDelegate(
  owner: Account,
  contractId: string,
  proposalId: number,
  proposalHash: string,
  remember: boolean,
  blockHeightTtl = 120,
): Promise<SignedDelegate> {
  const call = actionCreators.functionCall("cosign", { proposal_id: proposalId, proposal_hash: proposalHash, remember }, GAS, 0n);
  const [, signed] = await owner.createSignedMetaTransaction(contractId, [call], blockHeightTtl);
  return signed;
}

export function encodeForRelay(sd: SignedDelegate): string {
  return Buffer.from(encodeSignedDelegate(sd)).toString("base64");
}

export function decodeSignedDelegate(b64: string): SignedDelegate {
  return deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")) as SignedDelegate;
}

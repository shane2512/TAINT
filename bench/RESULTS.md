# Results log

Everything here is from **MOCK** runs with **hand-authored model outputs** unless it says LIVE. No LIVE run has happened.

## 2026-10-29 MOCK replay

`npm run replay -- --fixtures F1,F2,F3,L1,L2`: 15 of 15 rows match their declared expectation. Run the command to see the table; it prints `mode=MOCK` and a note that the model outputs are hand-authored.

## 2026-10-29 MOCK red team

`npm run redteam`: 10 attempts. 9 held for co-sign or refused before reaching the contract. 1 executed by design (R07). 0 failures.

### Finding, fixed during development
**Ungrounded planner literals were treated as owner-class.** While writing R09 (a fooled planner that emits `{"literal":"attacker.testnet"}`), `buildProposal` stamped any planner literal as `Owner`, so the contract would have executed it. Fix: a literal is accepted only if it appears as a whole token in the owner's signed instruction. Tests: `runtime/test/proposal-grounding.test.ts` (written failing first). Trade-off: a planner that legitimately normalises a value ("1.0 NEAR" for "1 NEAR") is now refused; the design fails closed.

### Process finding
Recordings are keyed by the planner's prompt (owner text plus coarse handle summaries), so two cases with the same prompt cannot record different outputs. A fixture silently overwrote another's recording before the generator learned to refuse that. See `runtime/test/gen-recordings.test.ts`.

## Not done (needs credentials or tooling)

- **LIVE drain rate** of the Naive agent on F1 (needs `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`). The README's headline claim, that the naive agent is really drained by the real attack, is unproven until this runs.
- LIVE red team with real models.
- `taint.near` in Rust, deployed; TEE attestation decision (`docs/decisions/0001-attestation.md`).
- Mainnet co-sign through a NEP-366 delegate action, including the replay-rejection line.
- L1 settled on mainnet.

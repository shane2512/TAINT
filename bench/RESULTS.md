# Results log

Everything here is from **MOCK** runs with **hand-authored model outputs** unless it says LIVE. No LIVE run has happened.

## 2026-10-29 MOCK replay

`npm run replay -- --fixtures F1,F2,F3,L1,L2`: 15 of 15 rows match their declared expectation. Run the command to see the table; it prints `mode=MOCK` and a note that the model outputs are hand-authored.

## 2026-10-29 MOCK red team

`npm run redteam`: 12 attempts. 10 held for co-sign or refused before reaching the contract. 2 executed by design (R07: an already-approved counterparty within its cap; R12: text typed into the signed instruction itself is the owner's). 0 failures.

### Finding, fixed during development
**Ungrounded planner literals were treated as owner-class.** While writing R09 (a fooled planner that emits `{"literal":"attacker.testnet"}`), `buildProposal` stamped any planner literal as `Owner`, so the contract would have executed it. Fix: a literal is accepted only if it appears as a whole token in the owner's signed instruction. Tests: `runtime/test/proposal-grounding.test.ts` (written failing first). Trade-off: a planner that legitimately normalises a value ("1.0 NEAR" for "1 NEAR") is now refused; the design fails closed.

### Findings from the whole-branch review, fixed
- **Role confusion.** Grounding proved the owner typed a value, not which role they meant it for. With two accounts or two amounts in the instruction, a wrong planner could pick the wrong one and it executed with no co-sign. Now demoted to untrusted (`owner-ambiguous`) and held. Tests: `proposal-grounding.test.ts`; red-team R11.
- **Replay depended on a deterministic model.** The flow hash covered the plan, so a live model re-planning the same signed message could yield a new hash and a second execution. The hash now derives only from the owner's nonce. Test: `taint-agent.test.ts` "blocks a replay even when the model plans something different the second time" (my first draft passed for the wrong reason and was corrected to fail first).
- **Text typed into the instruction itself** was untested and unstated. Added R12 (executes by design) and a README line.
- **Rule precision for the Rust port.** `bench/policy-cases.json` is now the shared rule table (20 cases after the contract review). Three rules came out of writing it: an amount must be 1..=u128 max; approve-and-remember never lowers an existing live entry; the rest pin down existing behaviour (window edge, flow_hash burn, pending TTL edge, payee cooldown restart).

### Findings from the contract review, fixed
A fresh reviewer read the Rust contract and judged it **not ready to deploy**. Fixed, each with a failing test first:
- **No way to recover once the full-access key is deleted.** A leaked worker key could send 5 NEAR a day to anywhere, forever, and the owner could neither revoke it, pause the contract (the PRD requires a pause), nor withdraw faster than the cap. Added `remove_worker`, `set_paused`, `withdraw` and `set_config`.
- **Missing provenance read as trusted.** A transfer with no provenance on its recipient skipped the untrusted checks and executed. Both implementations now treat provenance that does not match the action's arguments as malformed (three new shared cases).
- **`new` could be front-run** between deploy and init. It now requires the contract account as caller.
- **A leaked worker could lock the contract's balance in storage.** Source labels are limited to 128 bytes (the runtime truncates), and pending proposals to 100.
- **Test gaps on the co-sign path** (it schedules a payment; a capped co-sign schedules none) and a vacuous-looking u128 case (now also a JSON-layer test).
- **`mockdex` keeps deposits and has no withdraw**, so it now refuses to run outside `*.testnet`.

Deferred: payment-failure callback, storage-reserve-aware balance check, per-entry cumulative caps, re-pin cooldown restart, a code-upgrade path.

### Process finding
Recordings are keyed by the planner's prompt (owner text plus coarse handle summaries), so two cases with the same prompt cannot record different outputs. A fixture silently overwrote another's recording before the generator learned to refuse that. See `runtime/test/gen-recordings.test.ts`.

## Not done (needs credentials or tooling)

- **LIVE drain rate** of the Naive agent on F1 (needs `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`). The README's headline claim, that the naive agent is really drained by the real attack, is unproven until this runs.
- LIVE red team with real models.
- `taint.near` and `mockdex` **deployed** to testnet (both are built and tested locally; no NEAR accounts or keys yet); TEE attestation decision (`docs/decisions/0001-attestation.md`).
- Mainnet co-sign through a NEP-366 delegate action, including the replay-rejection line.
- L1 settled on mainnet.

# NEAR HACKATHON — final idea pack (after 10 generator → critic → validator loops)

Full debate: [loop-log.md](loop-log.md)

## Scoreboard: how the ideas evolved

| # | Idea | Fate | Why |
|---|---|---|---|
| A | LEASH: policy firewall for agent wallets | Merged into ESTATE (loop 1) | The track's obvious answer; `near-agent-guard` already exists |
| B | BAZAAR → **SHIPPED**: AI agents earn bounties by passing sealed tests in a TEE | **Fallback** (frozen at loop 4) | Very demoable, but reads as "CI + escrow" (Innov 6) |
| C | SEALED → PROVEN: private attested trader records | Dropped (loop 3) | Forgeable inputs, dull demo, no consumer |
| D | HAGGLE: AI NPC shopkeepers with wallets | Replaced (loop 2) | AI Town clone, chain adds nothing |
| E | **ESTATE**: AI-guarded cross-chain crypto will | **LEAD** | Chain signatures are essential; AI does work that needs judgment; real-world story |
| F | TAB: x402 via Intents | Dropped (loop 4) | NEAR already ships this |
| G | CONCLAVE: TEE AI negotiation | Replaced (loop 5) | Dealproof / NDAI prior art; the agreed price leaks the limits |
| H | VERDICT: attested AI judgments on-chain | Folded into ESTATE (loop 6) | a16z already wrote the thesis; works better as a module than a product |

Final critic scores, ESTATE: Innovation 7 · Creativity 7–8 · Feasibility 5 · Technical depth 8 · Impact 7 · Demo 7 · Jury fit 8. Validator win probability: **medium, rising to medium-high** if the ETH live payout, the scam-hold demo and the contract tests are all visible.

Tracks to tick: `realworld`, `security`, `privacy`, `agents`.

---

## ESTATE: the frozen design

**One-liner:** a crypto will for native BTC and ETH, controlled by NEAR chain signatures, with no bridges. A private AI drafts the will and flags possible scam or coercion signals around heirs. **The AI has no power to move funds**: it can only pick among branches the owner signed, and holding is the only direction it can push.

**Contract (`estate.near`, Rust)**
- Derives the BTC and ETH addresses from the path `estate/<owner>/<chain>` through the MPC signer. The owner can withdraw while alive.
- The will is a hash commitment, revealed at execution. **The contract builds each payout tx** from (recipient, %) using omni-transaction-rs. The agent supplies only nonce, UTXOs and gas.
- Timelock: only an owner-signed heartbeat counts. After the inactivity period T comes a challenge period C, during which the owner can `veto`.
- Guardians (M-of-N, Sputnik DAO or Trezu):
  - They resolve escalations and co-sign withdrawals above a per-period limit.
  - They hold a backup decryption key for the will.
  - Guardian-set changes are queued with `eta ≥ T`.
  - They can **never** start execution while the owner is sending heartbeats, and an owner veto always wins.
- Clauses have the shape `{source_domain, rubric_hash, branches:[pay, escalate], deadline, default:pay, hold_until}`.
  - `submit_judgment(branch, attestation)` accepts results from either 1 or 2 models.
  - The guardian resolves an escalation with `resolve`. If the guardian is silent past `hold_until`, the clause falls back to its default.
- Will reveal: the plaintext is encrypted to the TEE key **and** the guardian threshold key. If the TEE dies, guardians reveal it and anyone can crank.
- Fee ceiling with a bounded bump, and heir claims signed from a registered account. The dispute bond is cut; `hold_until` covers the same need.
- No full-access key after deploy.

**Shade Agent (TEE)**
- Registered via its attested codehash.
- Holds the encrypted will.
- Fetches the public source over HTTPS, with the domain pinned in the signed clause, and hashes the response.
- Runs the 2-model judge on NEAR AI Cloud, with output constrained to an enum.
- Cranks execution and sends Telegram notifications.

**AI jobs**
1. **Drafter:** turns plain language into will JSON, and refuses any clause without a pinned public source, a deadline and a default.
2. **Clause judge:** for the scam-hold clause, it reads the heir's public Farcaster casts from the last 30 days. Real ambiguity (venting, jokes, grooming) is why an LLM is needed. It can only HOLD and escalate to the guardian, never redirect.

**What's private:** the will's contents (TEE-encrypted until execution). **What's public:** the clause sources (public casts), on-chain state and the judgments.

**Honest limits:**
- The scam-hold is a safety net, not detection. The default is pay, and Bob can post nothing at all.
- The judge trusts the source domain's TLS.
- A thief with the owner key can heartbeat forever and block the inheritance until the guardians freeze withdrawals and the key is rotated.
- A thief with the owner key can drain funds only in bounded amounts per period, and guardians can freeze withdrawals.
- The guardian threshold can read the will early. It is private from outsiders, not from the guardians.
- A compromised owner key plus a guardian majority is out of scope.
- "Inheritance automation, not legal advice."

---

## 14-day plan (solo-dev defaults in brackets)

| Day | Work |
|---|---|
| D1 | Shade/TEE registration spike first (the biggest unknown), then ETH sign + broadcast from the contract (Sepolia). Run them in parallel only with 2 devs |
| D2–3 | Derivation, withdraw, heartbeat |
| D4–5 | BTC testnet build and sign [solo: skip, prerecord later] |
| D6–7 | Timelock, veto, guardian resolve + freeze + backup reveal, fee ceiling (no bump) + tests |
| **D7 end** | **GO/NO-GO**: ETH + TEE + timelock working, or pivot to SHIPPED (its skeleton is kept warm until then) |
| D8 | Drafter + refusal |
| D9–10 | Farcaster fetch + 2-model judge + `submit_judgment` + `hold_until` |
| D11 | End-to-end on testnet, `MOCK=1` replay, minimal UI (CLI + 2 screens) |
| D12 | Attack-table tests, `make redteam` (5+), README |
| D13 | Record the video, post on X |
| D14 | Buffer and submit |

**Cut order:** fee bump and queued guardian changes (move to roadmap) → absence parser → 2nd model (honest single pass) → BTC live (prerecorded) → UI polish.

**Solo-dev build:** ETH-only live, BTC prerecorded, CLI plus one page, no queued guardian changes.

## Final verdict (validator, loop 10)
- **Build ESTATE.** SHIPPED carries the same TEE registration risk but has weaker innovation (6) and reads as "CI + escrow" to judges.
- **Win probability:** medium with a team, medium-high if the ETH payout and the HOLD judgment run live. Solo: low-medium, and the limit is feasibility, not the concept.
- **If the gate fails:** if the TEE worked but the chain-sig path didn't, switch to SHIPPED. If TEE registration is the blocker, neither idea works; fall back to a local TEE mock and label it honestly.

## First 48 hours: validate these before writing anything else
1. **Shade Agent works end to end.** Register it on testnet with its codehash allowlisted and the worker key calling the contract. From inside it, make one NEAR AI Cloud inference call with enum-constrained output.
2. **A contract-built ETH tx goes out.** Build it with omni-transaction-rs, sign it through the MPC signer, and broadcast it on Sepolia from a derived address funded by a faucet.
3. **The judge is reliable.** Fetch from a Farcaster hub, then run the 2-model judge on about 12 hand-written cast sets (5 scam-like, 5 benign, 2 injections). If the models disagree often, switch now to a single pass with escalation on low confidence.

**Never cut:**
- Live ETH payout from a chain-sig address
- Contract-built tx
- Timelock and veto
- One attested scam-hold judgment
- The README path

---

## README (corrected, for the Claude Code / Codex judges)

```
# ESTATE — a crypto will whose AI has no power to move funds

What: inheritance for native ETH (live on Sepolia) and BTC (testnet, shown in video) using
NEAR chain signatures — no bridges, no single private key (the NEAR MPC network signs).
A Shade Agent (TEE) calls private inference on NEAR AI Cloud to draft the will and flags possible scam/coercion signals in an
heir's public posts. It can only choose between branches the owner signed: pay, or hold for a guardian.

Prerequisites: Node 20, Rust + cargo-near, near-cli-rs. MOCK=1 needs no keys and no network
(attestations are labeled PLACEHOLDER). Live mode: NEAR testnet account + NEAR AI Cloud key in .env.

Demo estates are pre-funded on testnet. Each command prints what to look for.

1. make setup                      → estate ids A and B + derived ETH/BTC addresses + balances
2. make draft WILL=examples/will.txt
                                   → will JSON; clause "bob-scam-hold": source=farcaster, branches=[pay, escalate],
                                     deadline, default=pay, hold_until
3. make draft WILL=examples/fuzzy.txt
                                   → REFUSED: "'if Bob is in a good place' has no verifiable public source"
4. make sign ESTATE=A              → will hash on-chain (explorer link)
5. make veto-demo ESTATE=A         → challenge opened → owner veto → state back to ACTIVE
6. make fast-forward ESTATE=A      → (testnet-only build with test clock) ACTIVE → CHALLENGE → EXECUTABLE
7. make judge ESTATE=A CASTS=examples/casts_scam.json
                                   → {branch: escalate, models: 2/2, response_hash, attestation}
8. make execute ESTATE=A           → Alice 60% paid (Sepolia link); Bob 40% HELD
9. make guardian-resolve ESTATE=A DECISION=pay
                                   → Bob paid (Sepolia link)  [or wait hold_until → default pay]
10. make judge ESTATE=B CASTS=examples/casts_ok.json && make execute ESTATE=B
                                   → branch: pay; both heirs paid directly
11. make rogue                     → unregistered key calls submit_judgment → REJECTED (codehash not allowlisted)
                                     agent supplies tampered recipient → impossible (contract builds tx)
12. make redteam                   → injection/abuse attempts in casts; each ends in a signed branch or escalation
13. make verify-keys               → near account list-keys estate.testnet → no full-access keys

Design principle: AI proposes, contract disposes. docs/what-each-model-sees.md lists exact inputs.
```

## Attack table (each row has a repro command or test)

| Attacker | Attempt | Result | Proof |
|---|---|---|---|
| Rogue TEE operator | Redirect a payout | Impossible: the contract builds the tx from the signed will | `make rogue`, `test_tx_built_from_will` |
| Rogue or dead TEE | Stall execution | Guardians reveal the will with the backup key, then anyone can crank. A bad UTXO or nonce gives an invalid tx, never a changed recipient | `test_backup_reveal_crank` |
| Unregistered agent | Submit a fake judgment | Rejected: codehash not allowlisted | `make rogue` |
| AI hallucination | Wrong branch | Can only choose {pay, hold}. Worst case is a delay, capped by `hold_until` | `test_hold_until_defaults_pay` |
| Bob or a scammer | Inject prompts in casts, or craft casts to trigger a false hold | Enum output and casts treated as data. Worst case is a capped delay. Attempts are logged | `make redteam` |
| Unreachable guardian | Hold stuck forever | After `hold_until` the clause takes its default (pay) | `test_hold_until_defaults_pay` |
| Owner-key thief | Drain funds | Bounded drain per period; above it needs a guardian co-sign; guardians can freeze withdrawals | `test_withdraw_cumulative_cap`, `test_guardian_freeze` |
| Owner-key thief | Heartbeat forever | Inheritance is blocked until a guardian freeze and key rotation (stated limitation) | `test_guardian_freeze` |
| Guardian majority | Force execution of a living owner's will | Impossible: guardians can't start execution, and an owner veto always wins | `test_guardian_cannot_trigger` |
| Hostile heir | Trigger early | Only owner-signed heartbeats count; the challenge window applies and notifications are sent | `test_heartbeat_owner_only` |
| Fee spike | Block execution | Owner-set ceiling plus a bounded bump | `test_fee_bump` |
| Upgrade backdoor | Change the code | No full-access key | `make verify-keys` |
| Out of scope | Owner key **and** guardian majority both compromised | Not defended. Stated openly | — |

## X post
> Built at NEAR HACKATHON: **ESTATE**, a crypto will whose AI has no power to move your funds.
> • Native ETH and BTC through NEAR chain signatures: no bridges, no single private key (the NEAR MPC network signs)
> • A Shade Agent calls private AI on NEAR AI Cloud to draft your will, and refuses clauses it can't verify
> • It flags possible scam signals around your heirs, and can only *hold* a payout for a guardian, never redirect it
> Live: ETH payouts on Sepolia · BTC testnet shown in video
> [video] [repo]

## Demo video shot list (2:30)

| Time | Shot |
|---|---|
| 0:00–0:12 | Hook: "When you die, your crypto dies with you, or your heir gets scammed out of it." |
| 0:12–0:35 | Type a will in plain English; the AI compiles it. The fuzzy clause is **refused** (5-second beat) |
| 0:35–0:50 | Sign; derived ETH and BTC addresses shown funded (BTC prerecorded) |
| 0:50–1:05 | Fast-forward, challenge opens, Telegram warning arrives, no veto |
| 1:05–1:35 | The judge reads Bob's casts ("they said send 2 ETH to unlock my account…"). Both models return **HOLD**, attestation shown. Subtitle: "injection attempts are logged, not obeyed" |
| 1:35–1:55 | Execute: Alice's Sepolia link appears; Bob's share is held. The guardian resolves it, and Bob's link appears |
| 1:55–2:15 | Rogue agent tries to redirect funds: rejected. Attack table flashes |
| 2:15–2:30 | "The AI has no power to move funds." Repo, track tags, NEAR AI Cloud and Shade Agent logos |

## Fallback (only if the D6 gate fails): SHIPPED
AI coding agents race to fix a GitHub issue. A Shade Agent runs **sealed hidden tests** in a network-off container and signs the verdict, and the NEAR escrow pays the first passing agent, on any chain via Intents. Demo: Claude Code vs Codex race. Tracks: agents, swarms, privacy, business.

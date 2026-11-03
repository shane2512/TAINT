# Feature to end-to-end test map

Every feature of the site, the code behind it, and the browser test that exercises it. A test's ID is in its title, so `npx playwright test -g F27` (from `landing/`) runs that one. `landing/e2e/08-map.spec.ts` fails if this table and the test titles disagree.

Run: `npm run test:e2e` (real browser, production build, real runtime with `MOCK=1`, no chain).
Opt-in: `npm --prefix landing run test:e2e:live` (F58 to F61; needs `.env`, spends testnet NEAR and Groq quota).

## Landing page: `/`

| ID | Feature | Code | Spec |
|---|---|---|---|
| F01 | Hero says what TAINT is; the limits are stated on the page | `Sections.tsx` Hero, Modes | 01-landing |
| F02 | Nav scrolls to its sections, opens the app and the repository | `Shell.tsx` Nav | 01-landing |
| F03 | Product window counts its number up and says it is sample data | `Dashboard.tsx` | 01-landing |
| F04 | The halftone art is painted, and moves | `Halftone.tsx` | 01-landing |
| F05 | The rules widget answers from the real rules | `Widget`, `POST /policy/evaluate` | 01-landing |
| F06 | A source merely named "owner" is still outside | `Widget` | 01-landing |
| F07 | Results grid shows the saved live results | `Results`, `lib/data.ts`, `bench/results/` | 01-landing |
| F08 | The footer reaches every page of the app | `Footer` | 01-landing |
| F09 | Lenis smooth scroll; headings slide into place | `Shell.tsx` | 01-landing |
| F10 | Nothing from the reference or any made-up claim is left | whole page | 01-landing |
| F11 | Reduced motion: content at once, no scroll hijack | `Shell.tsx` | 01-landing |
| F76 | The two modes lead to the demo and the wallet page | `Modes` | 01-landing |
| F77 | The handle codes beside the widget keep changing | `Scramble` | 01-landing |
| F78 | FAQ opens one question at a time and says what is not done | `Faq` | 01-landing |

## Rob the Pet: `/demo`

| ID | Feature | API | Runtime | Unit tests | Spec |
|---|---|---|---|---|---|
| F12 | Presets labelled attack or legitimate in words | `GET /meta` | `server.ts` | `server.test`, `server-api.test` | 02-rob |
| F13 | F1, F2, F3, L1, L2: the three wallets match each fixture | `POST /attack` | `agents/*`, `mock-contract.ts` | `server.test`, `replay.test` | 02-rob |
| F14 | Held value names its source, links to co-sign | `POST /attack` | `provenance.ts` | `server.test` | 02-rob |
| F15 | Attack log, newest first | `GET /log` | `server.ts` | `server.test` | 02-rob |
| F16 | Own text explains it needs a live model in MOCK | `POST /attack` (501) | `server.ts` | `server.test` | 02-rob |
| F22 | Empty log, wallets waiting | `GET /log` | `server.ts` | | 00-first-run |
| F57 | Past the attack limit, the page says so | `POST /attack` (429) | `server.ts` | `server.test` | 99-rate-limit |
| F61 | Own text with a live model (opt-in) | `POST /attack` | `llm.ts`, `agents/*` | `server-api.test` | live/live-model |

## Co-sign: `/cosign`

| ID | Feature | API | Runtime | Unit tests | Spec |
|---|---|---|---|---|---|
| F17 | Held payment: action, source, amount, what is unknown | `GET /pending` | `cosign-view.ts` | `cosign-view.test`, `server.test` | 03-cosign |
| F18 | Approve once: executes, leaves the list, counts against the cap | `POST /cosign` | `mock-contract.ts` | `server.test` | 03-cosign |
| F19 | Approve once leaves no trace | `POST /attack` | `mock-contract.ts` | `server.test` | 03-cosign |
| F20 | Nothing waiting, link to the demo | `GET /pending` | | | 00-first-run |
| F23 | Lookalike called out | `GET /pending` | `cosign-view.ts` | `server.test` | 03-cosign |
| F24 | A swap offers no "remember" | | `mock-contract.ts` | | 03-cosign |
| F25 | Second approval refused | `POST /cosign` | `mock-contract.ts` | `server.test` | 03-cosign |
| F26 | Changed proposal refused by the hash check | `POST /cosign` | `mock-contract.ts` | `server.test` | 03-cosign |
| F27 | Approve and remember: entry added, its cap still binds | `POST /cosign` | `mock-contract.ts` | `server.test` | 03-cosign |
| F28 | Approval past the 24h cap refused | `POST /cosign` | `mock-contract.ts` | `policy-cases.test` | 03-cosign |
| F58 | Real testnet: approved from the page through the relayer (opt-in) | `POST /cosign` | `cosign.ts`, `relayer.ts`, `near.ts` | `cosign.test`, `server-chain.test` | live/testnet |
| F60 | On testnet the simulated demo and mock suites are off (opt-in) | `POST /attack`, `/redteam` | `server.ts` | `server-chain.test`, `server-api.test` | live/testnet |

## Wallet: `/wallet`

| ID | Feature | API | Runtime | Unit tests | Spec |
|---|---|---|---|---|---|
| F21 | Empty book and pins, 0 of 5 NEAR | `GET /wallet` | `server.ts` | `server-api.test` | 00-first-run |
| F29 | Remember with a cap, survives reload, forget | `POST /wallet/remember`, `/forget` | `mock-contract.ts` | `server-api.test` | 04-wallet |
| F30 | Pin and unpin | `POST /wallet/pin`, `/unpin` | `mock-contract.ts` | `server-api.test` | 04-wallet |
| F31 | Bad account or cap refused, nothing changes | `POST /wallet/remember` (400) | `handles.ts` | `server-api.test` | 04-wallet |
| F32 | A preset's pinned vendor appears | `GET /wallet` | `setup.ts` | | 04-wallet |
| F33 | Contract-only owner calls listed, no fake buttons | | | | 04-wallet |
| F59 | On testnet: read from the chain, no writes (opt-in) | `GET /wallet` | `near.ts` | `server-api.test` | live/testnet |

## Policy: `/policy`

| ID | Feature | API | Runtime | Unit tests | Spec |
|---|---|---|---|---|---|
| F34 | Shared rule table runs, all cases pass | `GET /policy/cases` | `bench/policy-runner.ts` | `policy-cases.test`, `server-api.test`; Rust: `policy_cases.rs` | 05-policy |
| F35 | Outside value held, owner value executes | `POST /policy/evaluate` | `mock-contract.ts` | `server-api.test` | 05-policy |
| F36 | Remembered recipient, 1 NEAR cap | same | same | `server-api.test` | 05-policy |
| F37 | Pinned payee, 0.5 NEAR cooldown cap | same | same | `server-api.test` | 05-policy |
| F38 | Already-spent counts against 5 NEAR | same | same | `server-api.test` | 05-policy |
| F39 | Outside swap token always held | same | same | `server-api.test` | 05-policy |
| F40 | Attacker text shown as text, not run | same | React escaping | | 05-policy |
| F65 | An outside source merely named "owner" is still outside | `PolicyDesk.tsx` | | 05-policy |
| F41 | Invalid recipient explained | same (400) | `handles.ts` | `server-api.test` | 05-policy |
| F42 | The desk changes nothing in the wallet | same | fresh contract per call | `server-api.test` | 05-policy |

## Red team and results: `/redteam`, `/results`

| ID | Feature | API or file | Runtime | Unit tests | Spec |
|---|---|---|---|---|---|
| F43 | Attacks listed before running | `bench/redteam/` | `lib/data.ts` | | 06-proof |
| F44 | Run: 10 held or refused, 2 by design, 0 failures | `POST /redteam` | `bench/redteam.ts` | `redteam.test`, `server-api.test` | 06-proof |
| F45 | Saved live runs, with error rows | `bench/results/*redteam*.md` | `lib/data.ts` | `redteam-live.test` | 06-proof |
| F46 | Live replay table equals the saved file | `bench/results/*-LIVE.json` | `lib/data.ts` | `replay-live.test` | 06-proof |
| F47 | Mock replay runs, 15 of 15 | `POST /replay` | `bench/replay.ts` | `replay.test`, `server-api.test` | 06-proof |
| F48 | Testnet transactions link out; what is not done is stated | | | | 06-proof |

## Every page

| ID | Feature | Code | Spec |
|---|---|---|---|
| F49 | Mode banner and active nav on all six pages | `AppShell.tsx`, `GET /meta` | 07-shell |
| F50 | Brand goes back to the landing page | `AppShell.tsx` | 07-shell |
| F51 | Keyboard focus with a visible ring | `globals.css` | 07-shell |
| F52 | Proxy answers 503 with the command to run | `app/api/[...path]/route.ts` | 07-shell |
| F53 | All six pages explain a missing runtime | `AppShell.tsx` | 07-shell |
| F54 | Landing still reads with no runtime; the desk explains itself | `PolicyDesk.tsx` | 07-shell |
| F55 | All seven routes fit a phone with no sideways scroll | `globals.css` | 07-shell |
| F56 | Rob, then co-sign, on a phone | | 07-shell |

## Public demo: separate runtime, free text off

| ID | Feature | Code | Unit tests | Spec |
|---|---|---|---|---|
| F62 | Each visitor has a separate wallet, log and held list | `app/api/[...path]/route.ts`, `server.ts` visitors | `server-public.test` | 09-public |
| F63 | No free-text attack on the public demo, and the API refuses it too | `server.ts` `publicDemo`, `demo/page.tsx` | `server-public.test` | 09-public |
| F64 | The visitor id is an HttpOnly cookie | `route.ts` | | 09-public |

## Approve on testnet with your own wallet: `/cosign`, lower section

A stub NEAR RPC stands in for testnet, and a fake wallet for the real one (the test build sets `NEXT_PUBLIC_WALLET_MOCK`). The real wallet popup is not automated.

| ID | Feature | Code | Unit tests | Spec |
|---|---|---|---|---|
| F66 | The real contract's held payments, with source and lookalike warning | `GET /chain/pending`, `NearViewClient`, `WalletCosign.tsx` | `server-api.test` | 10-wallet |
| F67 | No wallet: nothing can be approved; Connect asks the wallet | `WalletCosign.tsx` | | 10-wallet |
| F68 | A wallet that is not the owner account cannot approve | `WalletCosign.tsx` | | 10-wallet |
| F69 | The owner's wallet signs one `cosign` call for that proposal | `WalletCosign.tsx` | | 10-wallet |
| F70 | Approve and remember sets `remember` | `WalletCosign.tsx` | | 10-wallet |
| F71 | A contract refusal returned as a value is shown as a refusal | `lib/outcome.ts` | `relayer-outcome.test` (same check, relayed path) | 10-wallet |
| F72 | A wallet the owner declines in leaves the proposal untouched | `WalletCosign.tsx` | | 10-wallet |
| F73 | Return from a redirect wallet reports what the chain did | `WalletCosign.tsx` | | 10-wallet |
| F74 | Return after a refusal says the contract refused it | `lib/outcome.ts` | | 10-wallet |
| F75 | A server with no testnet contract configured says so | `GET /chain/info` | `server-api.test` | 10-wallet |

## Not covered by a browser test

- **The look of the animations.** F09 and F11 check they run and end correctly. Whether they match the reference video is a judgement by eye.
- **Mainnet and wallet signing.** Neither exists.
- **The contract's owner calls** (`set_paused`, `remove_worker`, `withdraw`, `set_config`): tested in Rust, with no UI (`npm run test:contract`).
- **The CLI scripts** (`cosign-demo`, `gen-recordings`, `check:env`, `setup:env`): no browser surface; covered by Vitest or their own output.

## Live site (opt-in, real testnet contract and a real model)

Run from `landing/`: `node e2e/run.mjs -c playwright.live.config.ts --project=livesite`. The wallet is a Node-side signer holding the relayer testnet key; everything else is real. File: `e2e/live/live-site.spec.ts`.

| ID | What it proves |
|---|---|
| L1 | A visitor connects, opens an account (if needed), authorises the agent, runs F1 on a real model; the attack is held (or declined), never executed |
| L1b | A held payment on the real contract is approved with the visitor's wallet, pays out, and leaves the held list |
| L2 | The account page shows the contract balance and the owner pauses and resumes with their own wallet |
| L3 | Without a wallet nothing runs; the old simulated routes are gone |

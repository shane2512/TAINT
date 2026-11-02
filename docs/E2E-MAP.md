# Feature to end-to-end test map

Every feature of the site, the code behind it, and the browser test that exercises it. A test's ID is in its title, so `npx playwright test -g F27` (from `landing/`) runs that one. `landing/e2e/08-map.spec.ts` fails if this table and the test titles disagree.

Run: `npm run test:e2e` (real browser, production build, real runtime with `MOCK=1`, no chain).
Opt-in: `npm --prefix landing run test:e2e:live` (F58 to F61; needs `.env`, spends testnet NEAR and Groq quota).

## Landing page: `/`

| ID | Feature | Code | Spec |
|---|---|---|---|
| F01 | Hero, tagline, limits line | `Sections.tsx` Intro | 01-landing |
| F02 | Section rail: click, arrows, active label, nav highlight | `Shell.tsx` | 01-landing |
| F03 | Compare shows real fixture text with the attacker's values flagged | `Sections.tsx` Demo, `lib/data.ts` | 01-landing |
| F04 | Drag handle moves the compare divide | `Sections.tsx` Demo | 01-landing |
| F05 | Policy desk answers from the real rules | `PolicyDesk.tsx`, `POST /policy/evaluate` | 01-landing |
| F06 | Benchmark rows equal the saved live run | `Sections.tsx` Benchmark, `lib/data.ts`, `bench/results/` | 01-landing |
| F07 | Feature tiles and FAQ swap their detail panel | `Sections.tsx` | 01-landing |
| F08 | All six links into the app, and the nav button | `Sections.tsx` Ecosystem | 01-landing |
| F09 | Lenis smooth scroll, heading scramble ends on the real words | `Shell.tsx` | 01-landing |
| F10 | No reference-site or filler text remains | whole page | 01-landing |
| F11 | Reduced motion: content at once, no scroll hijack | `Shell.tsx` | 01-landing |

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

## Not covered by a browser test

- **The look of the animations.** F09 and F11 check they run and end correctly. Whether they match the reference video is a judgement by eye.
- **Mainnet and wallet signing.** Neither exists.
- **The contract's owner calls** (`set_paused`, `remove_worker`, `withdraw`, `set_config`): tested in Rust, with no UI (`npm run test:contract`).
- **The CLI scripts** (`cosign-demo`, `gen-recordings`, `check:env`, `setup:env`): no browser surface; covered by Vitest or their own output.

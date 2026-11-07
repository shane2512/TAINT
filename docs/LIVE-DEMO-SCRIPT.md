# Live demo recording script (about 2:30)

This is the screen-recorded section of the main video. Everything on screen is real: testnet contract `taint-myname.testnet`, a real model, your own Meteor wallet. Do not say "TEE" or "attested": attestation is stubbed. Say "provenance gate on the contract".

## Before you hit record (10 minutes)

1. Warm the server: open https://taint.shinc.tech/demo and wait until the page shows the preset cards (the free host sleeps; first load takes up to a minute).
2. Meteor extension on **Testnet**, account `funrobe2504.testnet` selected, at least 4 NEAR in it.
3. Decide the account state you want to film:
   - **Fresh (best)**: use a second testnet account that has not opened a contract account, so you film "open account" and "authorise agent" for real.
   - Already open: skip scenes 2 and 3, start at scene 4.
4. Browser at 1440x900, zoom 100%, close other tabs, hide bookmarks bar. Record with OBS or Win+Alt+R. Mic check.
5. Do one dry run of F1 first (it uses the 6 runs per hour per account budget), then record.
6. Keep `https://testnet.nearblocks.io` open in a second tab for scene 7.

## Scenes

| # | Time | On screen | Say |
|---|------|-----------|-----|
| 1 | 0:00 | `/demo`, banner `mode=LIVE` visible, Connect card | "This is TAINT running live on NEAR testnet. No mock data: a real contract, a real model, and my own wallet." |
| 2 | 0:12 | Click **Connect wallet**, Meteor opens, pick the account, approve | "I connect my own Meteor wallet. The site holds no keys; every payment is signed by me." |
| 3 | 0:30 | **Open your account**: deposit 2 NEAR, approve in Meteor. Then **Authorise** the agent, approve | "I open my account in the contract with a 2 NEAR deposit, then authorise one agent, `worker-myname.testnet`. Only agents I name can propose payments." |
| 4 | 0:55 | Preset **F1**: the Bankr/Grok Morse-code tweet. Point at the OUTSIDE TEXT block | "The agent is told to handle my latest mention. Hidden in that tweet is a Morse-code instruction to send 1.5 NEAR to an attacker. This is a real attack from the wild." |
| 5 | 1:10 | Click run, sign the message in Meteor, wait for the three pets | "I sign once to prove the account is mine, then three agents get the same input: a naive agent, an allowlist agent, and TAINT." |
| 6 | 1:30 | Results: Naive and Allowlist columns, then TAINT column with outcome **pending** and the source line `x.com/@attacker` | "The other two only decide by prompt or address list. TAINT tracks where the recipient came from. The address came from an outside tweet, so the contract holds the payment instead of sending it." |
| 7 | 1:50 | Click the **tx link**, nearblocks shows the real `propose` call and a `Pending` result | "That is a real transaction on testnet. The funds did not move." |
| 8 | 2:00 | `/cosign`: the held card with its source and diff. Click **Approve once**, sign in Meteor | "Held payments wait for me. I can approve with my own wallet, and only then does the contract pay." |
| 9 | 2:20 | `/wallet`: balance, pause button, held list now empty | "My balance, my caps, my pause switch. Everything lives on the contract." |
| 10 | 2:30 | Back to talking head or title card | "TAINT: a wallet that knows where an instruction came from." |

Optional extra (+0:20): run **L1** (legit invoice from a pinned vendor) to show a good payment is not blocked. If it comes back pending, say "even this one waits for me, because the vendor is new" only if that is what the screen shows.

## Rules while recording

- After clicking run, wait up to 60 seconds. Do not click again (it burns your hourly runs).
- The model is not deterministic: the TAINT column may show `none` (the model refused the attack) instead of `pending`. That is a valid result: say "the model refused this time, and even if it hadn't, TAINT would hold it". Re-take if you want the held version; a retake costs one of 6 hourly runs.
- If the page says "demo server is waking up", stop, wait 60 seconds, reload, restart the scene.
- Never show the Meteor seed phrase, private key or the `.env` file. Crop or pause during any wallet backup screen.
- Say "testnet" out loud at least once. No mainnet claims.

## After recording

1. Trim dead time while the model is running (cut 10 to 20 seconds, keep the spinner for one second so it still looks real).
2. Add captions for scenes 4 and 6 (the Morse text, the `x.com/@attacker` line).
3. Export 1080p, under 140 seconds if posting directly to X, otherwise upload and link.

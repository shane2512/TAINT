# Setting up the NEAR testnet accounts

Everything here is **testnet**: the money is free and worth nothing. You create five throwaway accounts, put their keys in `.env`, and run one command that checks them. **Never paste a key into a chat, an issue or a commit.** If you ever do, delete that account and make a new one; it costs nothing.

## The five accounts

Pick a short unique prefix, for example `myname` (account names are global, so a plain name is probably taken).

| Role | Example id | What it does | Key it needs | Balance it needs |
|---|---|---|---|---|
| contract | `taint-myname.testnet` | holds the funds and the `taint.near` contract | full access (it deploys) | 15 NEAR or more (the contract's code is about 570 KB, which locks about 6 NEAR, plus funds to spend) |
| mockdex | `mockdex-myname.testnet` | testnet stand-in for swaps (NEAR Intents has no testnet) | full access | 3 NEAR or more |
| owner | `owner-myname.testnet` | approves held payments (demo only) | any | 0.5 NEAR or more |
| worker | `worker-myname.testnet` | the agent's account, calls `propose` | any (a function-call key limited to the contract is safest; full access works for now) | 1 NEAR or more, for gas |
| relayer | `relayer-myname.testnet` | pays the gas for the owner's one-tap approvals | full access | 2 NEAR or more |

Each role must be a **different account**. Use throwaway accounts, not your real wallet.

## 1. Install the NEAR CLI

The current NEAR docs use `near-cli-rs`. On Windows (PowerShell):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex"
```

On Linux or macOS: `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh`. These download and run an installer script, so read it first if you prefer. Check it worked with `near --version`.

## 2. Create the accounts (the faucet pays for them)

Run this once per account, changing the id. It makes the account, generates a key pair and saves it to your local credentials folder:

```powershell
near account create-account sponsor-by-faucet-service taint-myname.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

Do the same for `mockdex-myname`, `owner-myname`, `worker-myname` and `relayer-myname`.

## 3. Find each private key

With `save-to-legacy-keychain`, the key for each account is in a JSON file:

```
%USERPROFILE%\.near-credentials\testnet\<account-id>.json
```

Open it and copy the `private_key` value (it starts with `ed25519:`) into `.env`. Keep that file private.

## 4. Fill in `.env`

```powershell
copy .env.example .env
```

Fill in the five `*_CONTRACT` / `*_ACCOUNT` ids and the five `*_PRIVATE_KEY` values. The model settings (`LLM_*`) are only needed later, for the live model runs; leave them blank for now.

## 5. Top up the contract account

A faucet account starts with a small balance, probably less than the 15 NEAR the contract account needs. Send it more from your other accounts, or ask the faucet again. The checker tells you the exact balances.

## 6. Check everything

```powershell
npm run check:env
```

It reads `.env`, asks the testnet whether each account exists, whether each key is really on its account and has the right kind of access, and whether the balances are enough. It prints account ids, public-key prefixes and balances. **It never prints a private key.** Fix any `[FAIL]` line; `[WARN]` lines are advice. When it ends with `0 failed`, tell me and I'll deploy and run the live checks.

## What I will and won't do with these

- I deploy the two contracts to **your** testnet accounts, call `new` in the same batch as the deploy, and run the live demo. That costs testnet NEAR only.
- I will not create accounts, hold keys outside `.env`, or ask you to paste a key.
- **Mainnet is separate**: the plan's mainnet steps (a dust-sized payment and the one-tap approval) need their own accounts and a deliberate go-ahead from you, and are not part of this setup.

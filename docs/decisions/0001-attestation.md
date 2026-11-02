# 0001: Worker attestation is stubbed

Status: decided 2026-11-01 (see [0002](0002-attestation-requirements.md) for what real attestation needs, checked 2026-11-02). Mode: `ATTESTATION=stub` (the default). Every command prints `ATTESTATION STUBBED`.

## What we did not do

The plan called for a spike: deploy the Shade Agent template worker on testnet and register it so a contract can check its codehash. **That spike was not run.** It needs a Phala Cloud (or similar TEE) deployment and accounts we have not set up, and the work that decides whether the project is credible (the contract, the runtime, the benchmark, the co-sign path) came first. This record is therefore a decision to stub, not a finding that real attestation fails.

## What the Shade Agent flow looks like (from the public template repos, not run by us)

Per the NearDeFi `shade-agent-*` template READMEs: the worker runs in a TEE, derives its own NEAR key inside it, and calls the template contract's `register_worker`, submitting the TEE's remote attestation together with the Phala checksum and the Docker image codehash. The contract checks that attestation and records the codehash; only registered workers may then call the guarded methods. We have not read the current Shade docs end to end or run any of this, so treat the details as unverified and re-check them before relying on them.

## What `register_worker` does today

`taint.near` `register_worker(account_id)` is **owner-only**. The owner adds a worker account; the worker is an ordinary NEAR account with a key (`WORKER_PRIVATE_KEY` in `.env`). `propose` is worker-only. `remove_worker` and `set_paused` let the owner revoke or stop a leaked key. Nothing checks where the worker code runs or what code it is.

## What this means for the claim

- **Not claimed:** that the quarantined runtime runs in a TEE, that the planner and extractor code is the audited code, or that the worker key cannot be copied off the host.
- **Claimed:** given a registered worker key, the contract enforces the policy (provenance gate, address book, pins, co-sign, 24h cap). A leaked worker key can propose anything, but untrusted-derived values still need the owner, and executed value is bounded per day.
- **Cost of the stub:** a compromised host can fabricate provenance. If the worker lies that a recipient came from the owner, the contract believes it. Attestation is what would make provenance labels trustworthy; without it the guarantee is conditional on the worker host being honest. The README states this.

README sentence used in stub mode: "The worker is a plain registered key, not a TEE-attested one; provenance labels are only as trustworthy as the machine that runs the runtime."

## To make it real later

1. Deploy a Shade worker, read the current docs, and confirm the registration call and what it verifies.
2. Add a `register_worker_attested` path that checks the attestation and records the codehash; keep the owner-only path for the stub.
3. Run with `ATTESTATION=real`, which drops the banner suffix, and pin the codehash in the README.

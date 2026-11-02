# 0002: What real worker attestation needs, checked against the current docs

Status: researched 2026-11-02. **Not built.** Attestation is still stubbed ([0001](0001-attestation.md)); every command still prints `ATTESTATION STUBBED`.

0001 said the Shade Agent details were unverified. They are now read, from the current official sources (the NearDeFi `shade-agent-template` README, the `shade-agent-framework` README, the `shade-attestation` crate README and the template contract source, all fetched 2026-11-02). Nothing below was run by us.

## How the real thing works

- The worker runs in a TEE (Intel TDX, on Phala Cloud). It derives a NEAR account and key **inside** the TEE.
- That account calls the agent contract's `register_agent(attestation)` with a deposit. The contract verifies the attestation with the `shade-attestation` crate and records the agent with an expiry (`valid_until_ms`); an expired agent must register again.
- The crate checks: the Intel quote and collateral chain (dcap-qvl) at the block time, TCB status `UpToDate` with no outstanding advisories, that the quote's report data equals the expected value (this binds it to the signer), that the hardware ID (PPID) is in the owner's accepted list, and that the code measurements (MRTD, RTMR0 to RTMR3, key-provider event, app compose hash) match an owner-approved set.
- So "approved" means: the owner approved a specific measurement set and a specific machine, and only an agent running exactly that code on that hardware can register.

## What we would build

A `register_attested_worker` in `taint.near` that does the same, an owner call to approve measurements and PPIDs, a flag to refuse plain owner-registered workers once the attested path is live, and `propose` accepting only workers whose attestation is unexpired. Then the runtime runs in a TEE and registers.

## What blocks it, and who has to act

1. **A toolchain change in this repo.** `shade-attestation 0.2.0` pins `serde_with =3.17.0`; our `near-sdk 5.30.0` needs `serde_with >=3.20`. They cannot be in one build. The Shade template builds against `near-sdk =5.26.1`, so both our contracts would have to be pinned down to that and re-tested. That is doable but changes the SDK under a deployed contract.
2. **A C compiler for wasm.** The crate pulls in `ring`, which needs `clang` to compile for `wasm32`. This machine has MinGW gcc only. A probe build of just the crate failed on exactly this (`failed to find tool "clang"`). Fix: install LLVM, or build in Docker. Either is a change to the machine, so it needs the owner's approval.
3. **Docker.** The official flow (`shade deploy`) builds and pushes a Docker image. Docker is not installed (Windows 11 Home, virtualisation is on, WSL 2 is the default, so Docker Desktop would install, with an admin prompt).
4. **Accounts only the owner can make.** A Phala Cloud account and API key (https://cloud.phala.network/register), a Docker Hub account to hold the image, and Phala credits for the running deployment. The official template says delete unused deployments to avoid cost. `shade auth set all testnet create-new` creates NEAR credentials and takes the Phala key interactively; the key should be typed by the owner, not by an assistant.
5. **Maturity.** Both the framework and the attestation crate say they have **not had a formal audit**, and the older `shade-agent-cli` repository is marked deprecated with known critical vulnerabilities (the current CLI is `@neardefi/shade-agent-cli` from the framework repo). Mainnet use would need our own review.

## What could not be tested without a TEE

The crypto path against a real quote. The crate has fixture tests for parts of the chain, but an end-to-end registration needs a quote from real TDX hardware. Until a worker has registered on testnet from a real Phala deployment, none of this is demonstrated, and the README must not claim it.

## Order of work once 1 to 4 are settled

1. Pin both contracts to `near-sdk =5.26.1`, re-run the Rust tests and the shared rule table, confirm the deployed behaviour is unchanged.
2. Add the attested registration to `taint.near` behind the owner's flag; unit-test everything except the crypto, which is the crate's.
3. Upgrade the testnet contract with the owner's `upgrade` call (no key needed now), then run `shade deploy` for the worker, register, approve the measurements the deployment reports, flip the flag.
4. Pin the measurements in the README, and drop the stub notice only then.

## What the claim stays until then

The worker is a plain registered key, not a TEE-attested one; provenance labels are only as trustworthy as the machine that runs the runtime. A leaked worker key can propose, but untrusted-derived values still need the owner and executed value is capped per day.

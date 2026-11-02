# 0002: What real worker attestation needs, checked against the current docs

Status: researched 2026-11-02. **The contract side is built, tested and deployed to testnet (switched off); the worker side is not.** Attestation is still stubbed ([0001](0001-attestation.md)); every command still prints `ATTESTATION STUBBED`.

## Update, same day: what was built

With the owner's approval, LLVM 23.1.4 was installed (winget, for `clang`) and both contracts were pinned to `near-sdk =5.26.1`. All earlier Rust tests still pass on it. `shade-attestation 0.2.0` then builds for wasm.

`taint.near` now has (`contract/taint/src/attest.rs`):
- owner calls `approve_measurements`, `remove_measurements`, `approve_ppids`, `remove_ppids`, `set_require_tee`, `set_attestation_expiry_ms`, `remove_agent`;
- `register_attested_worker(attestation)`, payable, called by the worker's own implicit account: it must be an implicit account, the quote's report data must be that account's key, and the owner must have approved measurements and PPIDs; the check is the crate's `DstackAttestation::verify`;
- registrations expire (24 hours by default) and are re-checked against the owner's current approvals on every `propose`, so withdrawing an approval revokes the workers that depended on it;
- `set_require_tee(true)` makes plain owner-registered keys stop working, so only attested workers can propose;
- a view, `get_attestation`.

Everything is stored under one storage key, so the contract's state layout did not change and no migration is needed.

**Tested (18 new unit tests, 90 in all):** implicit-account rule, deposit, owner-only on every setting, the report data passed to the check is the account's key, expiry and renewal, revocation by removing an approval, the worker bound, and gating of `propose`. **Not tested, because it needs a real Intel TDX quote:** a genuine attestation being accepted. The tests use a stand-in verifier for that case. The real verifier is tested only in that it refuses a fake quote.

**Cost:** the wasm grew from about 601 KB to 1.58 MB, which the network refused to accept as one transaction (413). Stripping the symbol table brought it to 937 KB, which deployed on 2026-11-02; that locks about 9.4 NEAR in storage and leaves about 8 NEAR of the testnet contract's 17.7 spendable. Gas for a real verification has not been measured.

## What is still needed

Items 3 and 4 below, and the order of work from step 3 on. Items 1 and 2 are done.

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

## NEAR AI Cloud (docs.near.ai): what it is, and what it is not

Read 2026-11-02 from `docs.near.ai` (including its `llms.txt` page index) and `near.ai`.

**It is private, verifiable inference.** An OpenAI-compatible API in front of models that run in TEEs. Each model is labelled Confidential TEE (NEAR AI's own GPU fleet, with attestation and signatures), 3P Confidential TEE (a provider's own enclave) or Incognito (routed through the gateway, which runs in a TEE). A developer gets: gateway attestation, per-model hardware attestation reports (also endorsed by Intel), and response signatures. For a `provider_tee` model the signed text is `<model id>:<SHA-256 of the exact request>:<SHA-256 of the exact response>`, verified against a signing key that a verified attestation report vouches for. Setup is an account at cloud.near.ai, purchased credits and an API key.

**It is not a place to run our own code.** The index has no compute, container or agent hosting; only inference, attestation, signatures and SDKs. I found no NEAR-run service for hosting a custom worker, and the documented route for that remains the Shade Agent Framework on Phala (above). I cannot rule out something undocumented.

**What it would and would not give TAINT.**
- It could attest the **model**: that the planner and extractor outputs came from a named model running in a TEE, with a signature over the exact bytes. It also keeps the text the model reads (which is attacker-controlled) private from the host.
- It does **not** attest the **worker**: the code that labels each value as owner or outside and calls `propose`. That is the part the threat model depends on ("a compromised host can fabricate provenance"), and only the Shade/Phala route addresses it.
- So the two are different properties, not alternatives. Neither has been built into TAINT. Whether the NEAR AI models can enforce the strict JSON schemas our parsers rely on has not been checked.

### Using it (chosen 2026-11-02)

The runtime already speaks the OpenAI API (`runtime/src/llm.ts`), so the model call needs only `LLM_BASE_URL=https://cloud-api.near.ai/v1`, an API key and a model id. Two things from the public catalogue (`GET /v1/model/list`):
- Many models there are **not** verifiable: `anthropic/*` and others are `verifiable: false`, `providerType: external`, i.e. NEAR relays the call to the vendor. Only models with `verifiable: true` and `attestationSupported: true` run in an attested TEE. Candidates that also list `structured_outputs`: `Qwen/Qwen3.6-35B-A3B-FP8`, `Qwen/Qwen3.8-27B`, `z-ai/glm-5.3-flash` (vLLM on NEAR's own hardware), `moonshotai/kimi-k2.6` (via Chutes).
- Response signatures are fetched from `GET /v1/signature/{chat_id}` and cover the **exact** request and response bytes; the docs require sending the canonical model id with `x-no-aliasing: true`, and checking gateway and model attestation *before* the call. The OpenAI SDK parses the response, so verifying means a raw-fetch path. That is not built.

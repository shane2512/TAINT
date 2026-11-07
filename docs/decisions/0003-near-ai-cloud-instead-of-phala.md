# 0003: NEAR AI Cloud as the trusted-compute provider, not Phala

Status: decided 2026-11-07. Supersedes the Phala/Shade route in [0001](0001-attestation.md) and [0002](0002-attestation-requirements.md) for the hackathon.

## Decision
Use NEAR AI Cloud for verified inference. Do not set up Phala Cloud, Docker Hub or the Shade worker.

## What this buys
- The planner and extractor calls can run on a TEE-hosted model (Intel TDX, NVIDIA confidential GPUs). `runtime/src/near-ai-verify.ts` checks that the attestation report binds our nonce to the signing key, and checks the EIP-191 response signature over `model:sha256(request):sha256(response)`.
- NEAR AI Cloud also routes its evidence through Intel Trust Authority (NEAR AI blog, 2026-08-12), which can give an Intel-signed token. We do not verify that token or the quote chain yet.

## What this does not buy
- **It does not attest the worker.** The worker is the code that stamps `Owner`/`Untrusted` on each argument and calls `propose`. NEAR AI Cloud attests model inference; we found no offering that runs our own code and registers its measurement with our contract. A compromised worker key can still lie about provenance.
- So the contract's TEE path (`register_attested_worker`, `require_tee`) stays built, deployed and switched off, and the banner keeps saying `ATTESTATION STUBBED`.

## Claims allowed in public text
- "Inference can run on NEAR AI Cloud with checkable response signatures."
- "The provenance gate is enforced on-chain."
- Not allowed: "attested", "TEE-protected wallet", "verified agent".

## Open (needs credits, ask first)
- One real signed completion through `verifiedChat` (about 1 call, a fraction of a cent).
- Verify the TDX quote chain or the Intel Trust Authority token.

## Done 2026-11-07: one real signed completion
`npm run near-ai-signed` made one paid call to `Qwen/Qwen3.6-35B-A3B-FP8` (max 16 tokens, chat id `c5c8253e522a43968c8389e84d3c4aef`). The report bound our nonce to the signer, and the EIP-191 signature over `model:sha256(request):sha256(response)` recovered to that signer. The reply text was empty (the model spent the 16 tokens before answering); the signature check does not depend on that. Intel's quote chain was not verified.

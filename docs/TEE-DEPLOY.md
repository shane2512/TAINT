# Worker TEE attestation: runbook (Phala / Shade Agent)

Status 2026-11-07: **not run.** Contract side is built and deployed (switched off). Everything below needs accounts only the owner can create. Background: [0002](decisions/0002-attestation-requirements.md), [0003](decisions/0003-near-ai-cloud-instead-of-phala.md).

## You (owner) do, once
1. Start Docker Desktop (installed, v29.9.2; the daemon was not running when checked). `docker login` with a Docker Hub account.
2. Create a Phala Cloud account, add credits, make an API key (https://cloud.phala.network/dashboard/tokens).
3. `npm i -g @neardefi/shade-agent-cli`, then `shade auth set all testnet create-new` and **type the Phala key into the CLI yourself**. Do not paste it into chat.

## Then, in this order (I can do these once 1-3 are done)
4. Worker image: Dockerfile + `docker-compose.yaml` + `deployment.yaml` running `runtime/src/server.ts` in LIVE mode. The worker must take its NEAR key from the TEE (shade-agent-js) instead of `WORKER_PRIVATE_KEY`. `shade plan`, then `shade deploy` (environment: TEE).
5. The deployed worker's implicit account calls `register_attested_worker(attestation)` on the contract (payable, about 300 Tgas).
6. Owner calls `approve_measurements` and `approve_ppids` with the values the deployment reports, then `set_require_tee(true)`.
7. Check `get_attestation`, run F1 through the live site, then and only then change the banner (`ATTESTATION=real`) and the README.

## Until step 7 passes
README and every output keep saying `ATTESTATION STUBBED`. Delete the Phala deployment after the demo to stop charges.

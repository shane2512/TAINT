//! Worker attestation: a worker proves it runs approved code on approved hardware (Intel TDX, through dstack).
//!
//! The verification itself is `shade_attestation::DstackAttestation::verify`: the Intel quote and collateral chain, an
//! up-to-date TCB, the hardware ID (PPID), and the code measurements (MRTD, RTMR0..3, key-provider event, app compose
//! hash). That crate has had no formal audit. What is decided here is only the bookkeeping around it.
//!
//! Design, following the Shade contract template:
//! - the registering account must be an implicit account (64 hex characters = an ed25519 public key), and the quote's
//!   report data must equal that key, so the account is the keypair that was generated inside the TEE;
//! - the owner approves measurements and PPIDs; only a worker running exactly that code on that hardware can register;
//! - a registration expires, and is re-checked against the owner's current approvals every time it is used, so
//!   removing an approval revokes the workers that depended on it.
//!
//! Everything lives under one storage key rather than in the contract's state struct, so adding it needs no migration.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::{env, AccountId};
use shade_attestation::attestation::{AcceptedDstackAttestation, DstackAttestation, VerificationError};
use shade_attestation::measurements::{FullMeasurements, FullMeasurementsHex};
use shade_attestation::report_data::ReportData;
use shade_attestation::tcb_info::HexBytes;
use std::collections::BTreeMap;

pub type Ppid = HexBytes<16>;

const KEY: &[u8] = b"ATTEST";
/// Registrations kept at once, and approvals of each kind, so this blob (read on every proposal) stays small.
pub const MAX_AGENTS: usize = 20;
pub const MAX_APPROVED: usize = 10;
/// How long a registration lasts before the worker has to prove itself again.
pub const DEFAULT_EXPIRY_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Agent {
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    pub valid_until_ms: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
pub struct AttestState {
    /// When set, a plain owner-registered worker key no longer counts: only attested workers can propose.
    pub require_tee: bool,
    /// 0 means the default.
    pub expiry_ms: u64,
    pub measurements: Vec<FullMeasurementsHex>,
    pub ppids: Vec<Ppid>,
    pub agents: BTreeMap<AccountId, Agent>,
}

impl AttestState {
    pub fn load() -> Self {
        env::storage_read(KEY).map(|b| Self::try_from_slice(&b).unwrap_or_else(|_| env::panic_str("attestation state is corrupt"))).unwrap_or_default()
    }

    pub fn save(&self) {
        env::storage_write(KEY, &borsh::to_vec(self).unwrap());
    }

    pub fn expiry(&self) -> u64 {
        if self.expiry_ms == 0 { DEFAULT_EXPIRY_MS } else { self.expiry_ms }
    }

    pub fn approve_measurements(&mut self, m: FullMeasurementsHex) {
        if !self.measurements.iter().any(|x| same(x, &m)) {
            assert!(self.measurements.len() < MAX_APPROVED, "too many approved measurements");
            self.measurements.push(m);
        }
    }

    pub fn remove_measurements(&mut self, m: &FullMeasurementsHex) {
        self.measurements.retain(|x| !same(x, m));
    }

    pub fn approve_ppids(&mut self, ppids: Vec<Ppid>) {
        for p in ppids {
            if !self.ppids.iter().any(|x| **x == *p) {
                assert!(self.ppids.len() < MAX_APPROVED, "too many approved ppids");
                self.ppids.push(p);
            }
        }
    }

    pub fn remove_ppids(&mut self, ppids: &[Ppid]) {
        self.ppids.retain(|x| !ppids.iter().any(|p| **p == **x));
    }

    /// Registered, not expired, and still on the owner's approved lists.
    pub fn is_valid(&self, who: &AccountId, now_ms: u64) -> bool {
        self.agents.get(who).is_some_and(|a| {
            a.valid_until_ms >= now_ms && self.measurements.iter().any(|m| same(m, &a.measurements)) && self.ppids.iter().any(|p| **p == *a.ppid)
        })
    }

    /// Verifies the attestation for `who` and records the worker. Err carries the reason.
    pub fn register(&mut self, who: &AccountId, att: &DstackAttestation, now_ms: u64, verifier: &impl Verifier) -> Result<(), String> {
        let id = who.as_str();
        if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()) {
            return Err("Account ID must be an implicit account".into());
        }
        if self.measurements.is_empty() || self.ppids.is_empty() {
            return Err("the owner has not approved any measurements and PPIDs yet".into());
        }
        if !self.agents.contains_key(who) && self.agents.len() >= MAX_AGENTS {
            return Err("too many registered workers".into());
        }
        // The quote has to name this account's key, which the TEE generated.
        let mut report = [0u8; 64];
        report[..32].copy_from_slice(&hex::decode(id).map_err(|_| "Account ID must be hex".to_string())?);
        let accepted: Vec<FullMeasurements> = self.measurements.iter().cloned().map(Into::into).collect();
        let ok = verifier
            .verify(att, ReportData::from(report), now_ms / 1000, &accepted, &self.ppids)
            .map_err(|e| format!("Attestation verification failed: {e}"))?;
        self.agents.insert(who.clone(), Agent { measurements: ok.measurements.into(), ppid: ok.ppid, valid_until_ms: now_ms + self.expiry() });
        Ok(())
    }
}

/// Equality through the canonical encoding, so this does not depend on which traits the crate's types derive.
fn same<T: BorshSerialize>(a: &T, b: &T) -> bool {
    borsh::to_vec(a).unwrap() == borsh::to_vec(b).unwrap()
}

/// The part that needs a real Intel quote, behind a trait so everything around it can be tested without TDX hardware.
pub trait Verifier {
    fn verify(
        &self,
        att: &DstackAttestation,
        report_data: ReportData,
        now_s: u64,
        measurements: &[FullMeasurements],
        ppids: &[Ppid],
    ) -> Result<AcceptedDstackAttestation, VerificationError>;
}

pub struct Real;

impl Verifier for Real {
    fn verify(&self, att: &DstackAttestation, report_data: ReportData, now_s: u64, measurements: &[FullMeasurements], ppids: &[Ppid]) -> Result<AcceptedDstackAttestation, VerificationError> {
        att.verify(report_data, now_s, measurements, ppids)
    }
}

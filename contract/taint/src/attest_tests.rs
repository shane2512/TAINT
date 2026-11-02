//! Everything around the attestation check. The check itself needs a real Intel TDX quote, so these tests use a stand-in
//! verifier for the cases that must succeed, and the real verifier for the ones that must be refused.
use super::attest::{Verifier, MAX_AGENTS};
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use shade_attestation::attestation::{create_mock_dstack_attestation, AcceptedDstackAttestation, VerificationError};
use shade_attestation::measurements::{create_mock_full_measurements_hex, FullMeasurements};
use shade_attestation::report_data::ReportData;
use std::cell::RefCell;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MS: u64 = 1_000_000;
const T0: u64 = 1_000_000 * MS;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}
/// A 64-hex-character implicit account, like the ones a TEE derives.
fn implicit(n: u8) -> AccountId {
    acct(&format!("{:02x}", n).repeat(32))
}

fn ctx(predecessor: &AccountId, now_ns: u64, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(predecessor.clone())
        .block_timestamp(now_ns)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_yoctonear(1000 * NEAR))
        .build());
}

fn setup() -> Taint {
    ctx(&acct("taint.near"), T0, 0);
    let cfg = Config {
        remember_cap: U128(NEAR),
        remember_ttl_ns: U64(30 * 24 * 60 * 60 * 1000 * MS),
        payee_cooldown_ns: U64(24 * 60 * 60 * 1000 * MS),
        payee_cooldown_cap: U128(NEAR / 2),
        global_cap_24h: U128(5 * NEAR),
    };
    let mut c = Taint::new(acct("owner.near"), acct("dex.near"), cfg);
    ctx(&acct("owner.near"), T0, 0);
    c.register_worker(acct("plain.near"));
    c
}

fn ppid(n: u8) -> Ppid {
    near_sdk::serde_json::from_str(&format!("\"{}\"", format!("{:02x}", n).repeat(16))).unwrap()
}

/// Stands in for the real check: accepts anything, and remembers what it was asked.
struct Accepts {
    seen: RefCell<Option<([u8; 64], u64)>>,
}
impl Accepts {
    fn new() -> Self {
        Self { seen: RefCell::new(None) }
    }
}
impl Verifier for Accepts {
    fn verify(&self, _a: &DstackAttestation, report: ReportData, now_s: u64, m: &[FullMeasurements], p: &[Ppid]) -> Result<AcceptedDstackAttestation, VerificationError> {
        *self.seen.borrow_mut() = Some((report.to_bytes(), now_s));
        Ok(AcceptedDstackAttestation { measurements: m[0], ppid: p[0].clone(), advisory_ids: vec![] })
    }
}
struct Refuses;
impl Verifier for Refuses {
    fn verify(&self, _: &DstackAttestation, _: ReportData, _: u64, _: &[FullMeasurements], _: &[Ppid]) -> Result<AcceptedDstackAttestation, VerificationError> {
        Err(VerificationError::TcbStatusNotUpToDate("OutOfDate".into()))
    }
}

fn approved(c: &mut Taint) {
    ctx(&acct("owner.near"), T0, 0);
    c.approve_measurements(create_mock_full_measurements_hex());
    c.approve_ppids(vec![ppid(7)]);
}

fn register(c: &mut Taint, who: &AccountId, now_ns: u64, v: &impl Verifier) -> bool {
    ctx(who, now_ns, NEAR);
    c.register_with(create_mock_dstack_attestation(), v)
}

fn can_propose(c: &mut Taint, who: &AccountId, now_ns: u64, flow: &str) -> bool {
    ctx(who, now_ns, 0);
    let owner = Provenance { class: TrustClass::Owner, source: "owner".into() };
    let a = ProposedAction { kind: ActionKind::Transfer, recipient: Some(acct("alice.near")), token: None, amount: U128(NEAR / 10) };
    let p = ArgProvenance { recipient: Some(owner.clone()), token: None, amount: owner };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.propose(a, p, flow.into()))).is_ok()
}

use crate::types::{ActionKind, ArgProvenance, Provenance, TrustClass};
use crate::types::ProposedAction;

#[test]
fn the_real_check_refuses_an_attestation_that_is_not_a_genuine_quote() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    ctx(&who, T0, NEAR);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.register_attested_worker(create_mock_dstack_attestation())));
    let text = r.expect_err("expected a refusal");
    let msg = text.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains("Attestation verification failed"), "{msg}");
    assert!(!AttestState::load().is_valid(&who, T0 / MS));
}

#[test]
fn a_registration_must_come_from_an_implicit_account() {
    let mut c = setup();
    approved(&mut c);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| register(&mut c, &acct("worker.near"), T0, &Accepts::new())));
    assert!(format!("{:?}", r.expect_err("refused").downcast_ref::<String>()).contains("implicit account"));
}

#[test]
fn nothing_registers_before_the_owner_has_approved_code_and_hardware() {
    let mut c = setup();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| register(&mut c, &implicit(1), T0, &Accepts::new())));
    assert!(format!("{:?}", r.expect_err("refused").downcast_ref::<String>()).contains("has not approved"));
}

#[test]
fn a_registration_needs_a_deposit_for_its_storage() {
    let mut c = setup();
    approved(&mut c);
    ctx(&implicit(1), T0, 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.register_with(create_mock_dstack_attestation(), &Accepts::new())));
    assert!(format!("{:?}", r.expect_err("refused").downcast_ref::<String>()).contains("deposit"));
}

#[test]
fn the_quote_is_asked_to_name_the_registering_accounts_key() {
    let mut c = setup();
    approved(&mut c);
    let v = Accepts::new();
    let who = implicit(0xab);
    assert!(register(&mut c, &who, T0, &v));
    let (report, now_s) = v.seen.borrow().unwrap();
    assert_eq!(&report[..32], &[0xab; 32]);
    assert_eq!(&report[32..], &[0u8; 32]);
    assert_eq!(now_s, T0 / MS / 1000);
}

#[test]
fn a_refusal_from_the_check_registers_nothing() {
    let mut c = setup();
    approved(&mut c);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| register(&mut c, &implicit(1), T0, &Refuses)));
    assert!(format!("{:?}", r.expect_err("refused").downcast_ref::<String>()).contains("not up to date"));
    assert!(AttestState::load().agents.is_empty());
}

#[test]
fn a_registration_lasts_its_expiry_and_then_ends() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    let day_ns = 24 * 60 * 60 * 1000 * MS;
    assert!(AttestState::load().is_valid(&who, (T0 + day_ns) / MS));
    assert!(!AttestState::load().is_valid(&who, (T0 + day_ns) / MS + 1));
}

#[test]
fn the_owner_can_change_how_long_a_registration_lasts() {
    let mut c = setup();
    approved(&mut c);
    ctx(&acct("owner.near"), T0, 0);
    c.set_attestation_expiry_ms(U64(60_000));
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    assert!(!AttestState::load().is_valid(&who, T0 / MS + 60_001));
    assert!(AttestState::load().is_valid(&who, T0 / MS + 60_000));
}

#[test]
fn withdrawing_an_approval_revokes_the_workers_that_depended_on_it() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    assert!(AttestState::load().is_valid(&who, T0 / MS));

    ctx(&acct("owner.near"), T0, 0);
    c.remove_ppids(vec![ppid(7)]);
    assert!(!AttestState::load().is_valid(&who, T0 / MS), "a withdrawn PPID must revoke");
    c.approve_ppids(vec![ppid(7)]);
    assert!(AttestState::load().is_valid(&who, T0 / MS));
    c.remove_measurements(create_mock_full_measurements_hex());
    assert!(!AttestState::load().is_valid(&who, T0 / MS), "withdrawn measurements must revoke");
}

#[test]
fn the_owner_can_remove_a_worker_outright() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    ctx(&acct("owner.near"), T0, 0);
    c.remove_agent(who.clone());
    assert!(!AttestState::load().is_valid(&who, T0 / MS));
}

#[test]
fn approving_the_same_thing_twice_stores_it_once() {
    let mut c = setup();
    approved(&mut c);
    approved(&mut c);
    let s = AttestState::load();
    assert_eq!(s.measurements.len(), 1);
    assert_eq!(s.ppids.len(), 1);
}

#[test]
fn the_number_of_registered_workers_is_bounded() {
    let mut c = setup();
    approved(&mut c);
    for i in 0..MAX_AGENTS as u8 {
        register(&mut c, &implicit(i + 1), T0, &Accepts::new());
    }
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| register(&mut c, &implicit(200), T0, &Accepts::new())));
    assert!(format!("{:?}", r.expect_err("refused").downcast_ref::<String>()).contains("too many"));
    // a worker that is already registered can still renew
    assert!(register(&mut c, &implicit(1), T0 + 1000 * MS, &Accepts::new()));
}

#[test]
fn an_attested_worker_can_propose_and_an_unregistered_account_cannot() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    assert!(can_propose(&mut c, &who, T0, "f1"));
    assert!(!can_propose(&mut c, &implicit(2), T0, "f2"));
}

#[test]
fn an_expired_worker_cannot_propose_until_it_proves_itself_again() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    let later = T0 + 25 * 60 * 60 * 1000 * MS;
    assert!(!can_propose(&mut c, &who, later, "f1"));
    register(&mut c, &who, later, &Accepts::new());
    assert!(can_propose(&mut c, &who, later, "f2"));
}

#[test]
fn a_plain_worker_key_works_until_the_owner_requires_a_tee() {
    let mut c = setup();
    let plain = acct("plain.near");
    assert!(can_propose(&mut c, &plain, T0, "f1"));
    ctx(&acct("owner.near"), T0, 0);
    c.set_require_tee(true);
    assert!(!can_propose(&mut c, &plain, T0, "f2"), "once a TEE is required the plain key must stop working");
    assert!(!c.is_worker(plain.clone()));
    ctx(&acct("owner.near"), T0, 0);
    c.set_require_tee(false);
    assert!(can_propose(&mut c, &plain, T0, "f3"));
}

#[test]
fn an_attested_worker_still_works_when_a_tee_is_required() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    ctx(&acct("owner.near"), T0, 0);
    c.set_require_tee(true);
    assert!(can_propose(&mut c, &who, T0, "f1"));
    assert!(c.is_worker(who));
}

#[test]
fn the_attestation_view_shows_what_is_approved_and_who_is_valid() {
    let mut c = setup();
    approved(&mut c);
    let who = implicit(1);
    register(&mut c, &who, T0, &Accepts::new());
    ctx(&acct("owner.near"), T0, 0);
    let v = c.get_attestation();
    assert!(!v.require_tee);
    assert_eq!(v.approved_measurements.len(), 1);
    assert_eq!(v.approved_ppids.len(), 1);
    assert_eq!(v.agents.len(), 1);
    assert!(v.agents[0].1.valid);
    assert_eq!(v.agents[0].1.valid_until_ms.0, T0 / MS + 24 * 60 * 60 * 1000);
}

#[test]
fn every_attestation_setting_is_the_owners_alone() {
    let mut c = setup();
    let stranger = acct("stranger.near");
    let calls: Vec<(&str, Box<dyn Fn(&mut Taint)>)> = vec![
        ("approve_measurements", Box::new(|c| c.approve_measurements(create_mock_full_measurements_hex()))),
        ("remove_measurements", Box::new(|c| c.remove_measurements(create_mock_full_measurements_hex()))),
        ("approve_ppids", Box::new(|c| c.approve_ppids(vec![ppid(1)]))),
        ("remove_ppids", Box::new(|c| c.remove_ppids(vec![ppid(1)]))),
        ("set_require_tee", Box::new(|c| c.set_require_tee(true))),
        ("set_attestation_expiry_ms", Box::new(|c| c.set_attestation_expiry_ms(U64(1)))),
        ("remove_agent", Box::new(|c| c.remove_agent(implicit(1)))),
    ];
    for (name, f) in calls {
        ctx(&stranger, T0, 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut c)));
        let msg = format!("{:?}", r.expect_err(name).downcast_ref::<String>());
        assert!(msg.contains("owner only"), "{name}: {msg}");
    }
}

use super::*;
use crate::types::{Provenance, TrustClass};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MS: u64 = 1_000_000;
const T0: u64 = 1_000_000 * MS;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, now_ns: u64, balance_near: u128) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct(predecessor))
        .block_timestamp(now_ns)
        .account_balance(NearToken::from_yoctonear(balance_near * NEAR))
        .build());
}

fn config() -> Config {
    Config {
        remember_cap: U128(NEAR),
        remember_ttl_ns: U64(30 * 24 * 60 * 60 * 1000 * MS),
        payee_cooldown_ns: U64(24 * 60 * 60 * 1000 * MS),
        payee_cooldown_cap: U128(NEAR / 2),
        global_cap_24h: U128(5 * NEAR),
    }
}

fn setup() -> Taint {
    ctx("anyone.near", T0, 1000);
    let mut c = Taint::new(acct("owner.near"), acct("dex.near"), config());
    ctx("owner.near", T0, 1000);
    c.register_worker(acct("worker.near"));
    c
}

fn owner_prov() -> Provenance {
    Provenance { class: TrustClass::Owner, source: "owner".into() }
}
fn untrusted(s: &str) -> Provenance {
    Provenance { class: TrustClass::Untrusted, source: s.into() }
}
fn transfer(to: &str, amt: u128) -> ProposedAction {
    ProposedAction { kind: ActionKind::Transfer, recipient: Some(acct(to)), token: None, amount: U128(amt) }
}
fn owner_transfer_prov() -> ArgProvenance {
    ArgProvenance { recipient: Some(owner_prov()), token: None, amount: owner_prov() }
}

#[test]
fn an_account_id_with_consecutive_dots_does_not_deserialize() {
    assert!(near_sdk::serde_json::from_str::<AccountId>("\"acme..near\"").is_err());
}

#[test]
fn register_worker_marks_the_account_as_a_worker() {
    let c = setup();
    assert!(c.is_worker(acct("worker.near")));
    assert!(!c.is_worker(acct("stranger.near")));
}

#[test]
#[should_panic(expected = "owner only")]
fn register_worker_is_owner_only() {
    let mut c = setup();
    ctx("stranger.near", T0, 1000);
    c.register_worker(acct("stranger.near"));
}

#[test]
#[should_panic(expected = "worker only")]
fn propose_is_worker_only() {
    let mut c = setup();
    ctx("stranger.near", T0, 1000);
    c.propose(transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
}

#[test]
#[should_panic(expected = "owner only")]
fn remember_is_owner_only() {
    let mut c = setup();
    ctx("stranger.near", T0, 1000);
    c.remember(acct("alice.near"), None, None);
}

#[test]
#[should_panic(expected = "owner only")]
fn pin_is_owner_only() {
    let mut c = setup();
    ctx("stranger.near", T0, 1000);
    c.pin_account(acct("acme.near"));
}

#[test]
#[should_panic(expected = "owner only")]
fn cosign_is_owner_only() {
    let mut c = setup();
    ctx("stranger.near", T0, 1000);
    c.cosign(1, "h".into(), false);
}

#[test]
#[should_panic(expected = "pinned accounts only")]
fn only_a_pinned_account_can_register_a_payee() {
    let mut c = setup();
    ctx("acme.near", T0, 1000);
    c.register_payee_address(acct("pay.near"));
}

#[test]
fn remember_and_forget_change_the_book_view() {
    let mut c = setup();
    c.remember(acct("alice.near"), None, None);
    let book = c.get_book();
    assert_eq!(book.len(), 1);
    assert_eq!(book[0].0, acct("alice.near"));
    assert_eq!(book[0].1.cap, U128(NEAR));
    c.forget(acct("alice.near"));
    assert!(c.get_book().is_empty());
}

#[test]
fn pins_are_listed_and_unpin_removes_them() {
    let mut c = setup();
    c.pin_account(acct("acme.near"));
    assert_eq!(c.get_pins(), vec![acct("acme.near")]);
    c.unpin_account(acct("acme.near"));
    assert!(c.get_pins().is_empty());
}

#[test]
fn an_executed_transfer_schedules_a_transfer_to_the_recipient() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let out = c.propose(transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    assert!(matches!(out, ProposalOutcome::Executed { .. }));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, acct("alice.near"));
    match &receipts[0].actions[..] {
        [MockAction::Transfer { deposit, .. }] => assert_eq!(*deposit, NearToken::from_yoctonear(NEAR)),
        other => panic!("expected one Transfer, got {other:?}"),
    }
    assert_eq!(c.get_spent_24h(), U128(NEAR));
}

#[test]
fn an_executed_swap_schedules_a_buy_call_to_the_dex() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let action = ProposedAction { kind: ActionKind::Swap, recipient: None, token: Some(acct("newtoken.near")), amount: U128(NEAR / 5) };
    let prov = ArgProvenance { recipient: None, token: Some(owner_prov()), amount: owner_prov() };
    let out = c.propose(action, prov, "f1".into());
    assert!(matches!(out, ProposalOutcome::Executed { .. }));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, acct("dex.near"));
    match &receipts[0].actions[..] {
        [MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. }] => {
            assert_eq!(method_name, b"buy");
            assert_eq!(String::from_utf8(args.clone()).unwrap(), r#"{"token":"newtoken.near"}"#);
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(NEAR / 5));
        }
        other => panic!("expected one buy call, got {other:?}"),
    }
}

#[test]
fn a_held_proposal_schedules_nothing() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let prov = ArgProvenance { recipient: Some(untrusted("x.com/@a")), token: None, amount: owner_prov() };
    let out = c.propose(transfer("attacker.near", NEAR), prov, "f1".into());
    assert!(matches!(out, ProposalOutcome::Pending { .. }));
    assert!(get_created_receipts().is_empty());
    assert_eq!(c.get_spent_24h(), U128(0));
    assert_eq!(c.get_pending().len(), 1);
}

#[test]
fn a_transfer_the_contract_cannot_afford_is_rejected_and_not_counted() {
    let mut c = setup();
    ctx("worker.near", T0, 1);
    let out = c.propose(transfer("alice.near", 2 * NEAR), owner_transfer_prov(), "f1".into());
    assert_eq!(out, ProposalOutcome::Rejected { reason: "insufficient balance".into() });
    assert_eq!(c.get_spent_24h(), U128(0));
}

#[test]
#[should_panic(expected = "expired")]
fn a_pending_proposal_past_its_ttl_is_reported_expired_while_retained() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let prov = ArgProvenance { recipient: Some(untrusted("x")), token: None, amount: owner_prov() };
    let ProposalOutcome::Pending { proposal_id, proposal_hash, .. } = c.propose(transfer("n.near", NEAR / 2), prov, "f1".into()) else {
        panic!("expected pending")
    };
    ctx("owner.near", T0 + 16 * 60 * 1000 * MS, 1000);
    c.cosign(proposal_id, proposal_hash, false);
}

#[test]
#[should_panic(expected = "not pending")]
fn old_pending_records_are_pruned_so_storage_stays_bounded() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let prov = ArgProvenance { recipient: Some(untrusted("x")), token: None, amount: owner_prov() };
    let ProposalOutcome::Pending { proposal_id, proposal_hash, .. } = c.propose(transfer("n.near", NEAR / 2), prov, "f1".into()) else {
        panic!("expected pending")
    };
    // 25h later any propose prunes records older than the 24h retention
    ctx("worker.near", T0 + 25 * 60 * 60 * 1000 * MS, 1000);
    c.propose(transfer("alice.near", NEAR / 10), owner_transfer_prov(), "f2".into());
    ctx("owner.near", T0 + 25 * 60 * 60 * 1000 * MS, 1000);
    c.cosign(proposal_id, proposal_hash, false);
}

#[test]
#[should_panic(expected = "flow_hash too long")]
fn an_oversized_flow_hash_is_refused() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.propose(transfer("alice.near", NEAR), owner_transfer_prov(), "x".repeat(65));
}

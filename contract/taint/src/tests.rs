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
        .current_account_id(acct("taint.near"))
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
    ctx("taint.near", T0, 1000); // init must come from the contract account itself
    let mut c = Taint::new(acct("owner.near"), acct("dex.near"), config());
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(acct("owner.near"))
        .block_timestamp(T0)
        .attached_deposit(NearToken::from_yoctonear(500 * NEAR))
        .account_balance(NearToken::from_yoctonear(1000 * NEAR))
        .build());
    c.create_account(vec![]);
    ctx("owner.near", T0, 1000);
    c.register_worker(acct("worker.near"));
    c
}

/// The owner's account, for tests that look inside it.
fn tn(c: &Taint) -> &Tenant {
    c.tenants.get(&acct("owner.near")).unwrap()
}
fn tn_mut(c: &mut Taint) -> &mut Tenant {
    c.tenants.get_mut(&acct("owner.near")).unwrap()
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
    assert!(c.is_worker(acct("owner.near"), acct("worker.near")));
    assert!(!c.is_worker(acct("owner.near"), acct("stranger.near")));
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
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
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
    c.register_payee_address(acct("owner.near"), acct("pay.near"));
}

#[test]
fn remember_and_forget_change_the_book_view() {
    let mut c = setup();
    c.remember(acct("alice.near"), None, None);
    let book = c.get_book(acct("owner.near"));
    assert_eq!(book.len(), 1);
    assert_eq!(book[0].0, acct("alice.near"));
    assert_eq!(book[0].1.cap, U128(NEAR));
    c.forget(acct("alice.near"));
    assert!(c.get_book(acct("owner.near")).is_empty());
}

#[test]
fn pins_are_listed_and_unpin_removes_them() {
    let mut c = setup();
    c.pin_account(acct("acme.near"));
    assert_eq!(c.get_pins(acct("owner.near")), vec![acct("acme.near")]);
    c.unpin_account(acct("acme.near"));
    assert!(c.get_pins(acct("owner.near")).is_empty());
}

#[test]
fn an_executed_transfer_schedules_a_transfer_to_the_recipient() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    assert!(matches!(out, ProposalOutcome::Executed { .. }));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2); // the payment, then its callback
    assert_eq!(receipts[0].receiver_id, acct("alice.near"));
    match &receipts[0].actions[..] {
        [MockAction::Transfer { deposit, .. }] => assert_eq!(*deposit, NearToken::from_yoctonear(NEAR)),
        other => panic!("expected one Transfer, got {other:?}"),
    }
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(NEAR));
}

#[test]
fn an_executed_swap_schedules_a_buy_call_to_the_dex() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let action = ProposedAction { kind: ActionKind::Swap, recipient: None, token: Some(acct("newtoken.near")), amount: U128(NEAR / 5) };
    let prov = ArgProvenance { recipient: None, token: Some(owner_prov()), amount: owner_prov() };
    let out = c.propose(acct("owner.near"), action, prov, "f1".into());
    assert!(matches!(out, ProposalOutcome::Executed { .. }));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2); // the call, then its callback
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
    let out = c.propose(acct("owner.near"), transfer("attacker.near", NEAR), prov, "f1".into());
    assert!(matches!(out, ProposalOutcome::Pending { .. }));
    assert!(get_created_receipts().is_empty());
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(0));
    assert_eq!(c.get_pending(acct("owner.near")).len(), 1);
}

#[test]
fn a_transfer_the_contract_cannot_afford_is_rejected_and_not_counted() {
    let mut c = setup();
    tn_mut(&mut c).balance = NEAR; // the owner has only 1 NEAR in the contract
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("owner.near"), transfer("alice.near", 2 * NEAR), owner_transfer_prov(), "f1".into());
    assert_eq!(out, ProposalOutcome::Rejected { reason: "insufficient balance".into() });
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(0));
}

#[test]
#[should_panic(expected = "expired")]
fn a_pending_proposal_past_its_ttl_is_reported_expired_while_retained() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let prov = ArgProvenance { recipient: Some(untrusted("x")), token: None, amount: owner_prov() };
    let ProposalOutcome::Pending { proposal_id, proposal_hash, .. } = c.propose(acct("owner.near"), transfer("n.near", NEAR / 2), prov, "f1".into()) else {
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
    let ProposalOutcome::Pending { proposal_id, proposal_hash, .. } = c.propose(acct("owner.near"), transfer("n.near", NEAR / 2), prov, "f1".into()) else {
        panic!("expected pending")
    };
    // 25h later any propose prunes records older than the 24h retention
    ctx("worker.near", T0 + 25 * 60 * 60 * 1000 * MS, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR / 10), owner_transfer_prov(), "f2".into());
    ctx("owner.near", T0 + 25 * 60 * 60 * 1000 * MS, 1000);
    c.cosign(proposal_id, proposal_hash, false);
}

#[test]
#[should_panic(expected = "flow_hash too long")]
fn an_oversized_flow_hash_is_refused() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "x".repeat(65));
}

fn held_prov() -> ArgProvenance {
    ArgProvenance { recipient: Some(untrusted("x.com/@a")), token: None, amount: owner_prov() }
}

fn hold(c: &mut Taint, flow: &str) -> (u64, String) {
    ctx("worker.near", T0, 1000);
    match c.propose(acct("owner.near"), transfer("new.near", NEAR / 2), held_prov(), flow.into()) {
        ProposalOutcome::Pending { proposal_id, proposal_hash, .. } => (proposal_id, proposal_hash),
        other => panic!("expected pending, got {other:?}"),
    }
}

// ---- the deploy-time front-run (review I2) ----

#[test]
#[should_panic(expected = "init must be called by the contract account")]
fn new_refuses_a_caller_other_than_the_contract_account() {
    ctx("attacker.near", T0, 1000);
    Taint::new(acct("attacker.near"), acct("dex.near"), config());
}

// ---- recovering from a leaked worker (review C1) ----

#[test]
#[should_panic(expected = "worker only")]
fn a_removed_worker_can_no_longer_propose() {
    let mut c = setup();
    ctx("owner.near", T0, 1000);
    c.remove_worker(acct("worker.near"));
    assert!(!c.is_worker(acct("owner.near"), acct("worker.near")));
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
}

#[test]
#[should_panic(expected = "owner only")]
fn remove_worker_is_owner_only() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.remove_worker(acct("worker.near"));
}

#[test]
fn a_paused_contract_rejects_proposals_without_burning_the_flow_hash() {
    let mut c = setup();
    ctx("owner.near", T0, 1000);
    c.set_paused(true);
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    assert_eq!(out, ProposalOutcome::Rejected { reason: "paused".into() });
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(0));
    ctx("owner.near", T0, 1000);
    c.set_paused(false);
    ctx("worker.near", T0, 1000);
    let again = c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    assert!(matches!(again, ProposalOutcome::Executed { .. }), "{again:?}");
}

#[test]
fn a_paused_contract_refuses_a_cosign_and_keeps_the_proposal_pending() {
    let mut c = setup();
    let (id, hash) = hold(&mut c, "f1");
    ctx("owner.near", T0, 1000);
    c.set_paused(true);
    assert_eq!(c.cosign(id, hash.clone(), false), ProposalOutcome::Rejected { reason: "paused".into() });
    assert!(get_created_receipts().is_empty());
    c.set_paused(false);
    assert!(matches!(c.cosign(id, hash, false), ProposalOutcome::Executed { .. }));
}

#[test]
#[should_panic(expected = "owner only")]
fn set_paused_is_owner_only() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.set_paused(true);
}

#[test]
fn withdraw_sends_the_amount_and_ignores_the_rolling_cap() {
    let mut c = setup();
    ctx("owner.near", T0, 1000);
    let _ = c.withdraw(acct("owner.near"), U128(10 * NEAR)); // twice the 5 NEAR cap
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, acct("owner.near"));
    match &receipts[0].actions[..] {
        [MockAction::Transfer { deposit, .. }] => assert_eq!(*deposit, NearToken::from_yoctonear(10 * NEAR)),
        other => panic!("expected one Transfer, got {other:?}"),
    }
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(0));
}

#[test]
fn withdraw_still_works_while_paused() {
    let mut c = setup();
    ctx("owner.near", T0, 1000);
    c.set_paused(true);
    let _ = c.withdraw(acct("owner.near"), U128(NEAR));
    assert_eq!(get_created_receipts().len(), 1);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn withdraw_beyond_the_balance_is_refused() {
    let mut c = setup();
    ctx("owner.near", T0, 1000);
    let _ = c.withdraw(acct("owner.near"), U128(600 * NEAR)); // the owner has 500 NEAR in the contract
}

#[test]
#[should_panic(expected = "owner only")]
fn withdraw_is_owner_only() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let _ = c.withdraw(acct("worker.near"), U128(NEAR));
}

#[test]
fn set_config_changes_the_rolling_cap() {
    let mut c = setup();
    ctx("owner.near", T0, 1000);
    c.set_config(Config { global_cap_24h: U128(10 * NEAR), ..config() });
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("owner.near"), transfer("alice.near", 6 * NEAR), owner_transfer_prov(), "f1".into());
    assert!(matches!(out, ProposalOutcome::Executed { .. }), "{out:?}");
}

#[test]
#[should_panic(expected = "owner only")]
fn set_config_is_owner_only() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.set_config(config());
}

// ---- bounding what a worker can store (review I3) ----

fn with_source(len: usize) -> ArgProvenance {
    ArgProvenance { recipient: Some(untrusted(&"s".repeat(len))), token: None, amount: owner_prov() }
}

#[test]
#[should_panic(expected = "source too long")]
fn an_oversized_provenance_source_is_refused() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("new.near", NEAR / 2), with_source(129), "f1".into());
}

#[test]
fn a_source_of_exactly_128_bytes_is_accepted() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("owner.near"), transfer("new.near", NEAR / 2), with_source(128), "f1".into());
    assert!(matches!(out, ProposalOutcome::Pending { .. }), "{out:?}");
}

#[test]
fn the_hundred_and_first_pending_proposal_is_refused() {
    let mut c = setup();
    for i in 0..100 {
        hold(&mut c, &format!("f{i}"));
    }
    assert_eq!(c.get_pending(acct("owner.near")).len(), 100);
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("owner.near"), transfer("new.near", NEAR / 2), held_prov(), "f100".into());
    assert_eq!(out, ProposalOutcome::Rejected { reason: "too many pending".into() });
}

// ---- the co-sign path moves money (review M5) ----

#[test]
fn a_successful_cosign_schedules_the_payment() {
    let mut c = setup();
    let (id, hash) = hold(&mut c, "f1");
    ctx("owner.near", T0, 1000);
    assert!(matches!(c.cosign(id, hash, false), ProposalOutcome::Executed { .. }));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2); // the payment, then its callback
    assert_eq!(receipts[0].receiver_id, acct("new.near"));
    assert!(matches!(&receipts[0].actions[..], [MockAction::Transfer { .. }]));
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(NEAR / 2));
}

#[test]
fn a_cosign_the_cap_rejects_schedules_nothing() {
    let mut c = setup();
    let (id, hash) = hold(&mut c, "f1");
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", 5 * NEAR), owner_transfer_prov(), "f2".into());
    ctx("owner.near", T0, 1000); // a fresh environment, so earlier receipts are gone
    let out = c.cosign(id, hash, false);
    assert_eq!(out, ProposalOutcome::Rejected { reason: "global cap exceeded".into() });
    assert!(get_created_receipts().is_empty());
}

// ---- hardening ----

use near_sdk::PromiseResult;

fn ctx_with(predecessor: &str, now_ns: u64, balance: NearToken, storage_usage: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(acct(predecessor))
        .block_timestamp(now_ns)
        .account_balance(balance)
        .storage_usage(storage_usage)
        .build());
}

#[test]
fn a_payment_comes_out_of_the_owners_balance_and_one_owner_cannot_spend_anothers() {
    let mut c = setup();
    let before = tn(&c).balance;
    ctx("worker.near", T0, 1000);
    let ok = c.propose(acct("owner.near"), transfer("alice.near", NEAR / 10), owner_transfer_prov(), "f1".into());
    assert!(matches!(ok, ProposalOutcome::Executed { .. }));
    assert!(tn(&c).balance <= before - NEAR / 10, "the payment is taken from the owner's balance");
    // a second owner with a small balance cannot spend the first owner's NEAR even though the contract holds it
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(acct("bob.near"))
        .block_timestamp(T0)
        .attached_deposit(NearToken::from_yoctonear(NEAR))
        .account_balance(NearToken::from_yoctonear(1000 * NEAR))
        .build());
    c.create_account(vec![acct("worker.near")]);
    ctx("worker.near", T0, 1000);
    let out = c.propose(acct("bob.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    assert_eq!(out, ProposalOutcome::Rejected { reason: "insufficient balance".into() });
}

#[test]
fn the_rolling_window_keeps_a_bounded_number_of_payments() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    for i in 0..MAX_SPENT {
        if i % 25 == 0 {
            ctx("worker.near", T0, 1000); // a fresh gas budget; the contract's state carries over
        }
        let out = c.propose(acct("owner.near"), transfer("alice.near", 1), owner_transfer_prov(), format!("f{i}"));
        assert!(matches!(out, ProposalOutcome::Executed { .. }), "payment {i}: {out:?}");
    }
    let out = c.propose(acct("owner.near"), transfer("alice.near", 1), owner_transfer_prov(), "one-too-many".into());
    assert_eq!(out, ProposalOutcome::Rejected { reason: "too many payments".into() });
}

#[test]
fn an_executed_payment_schedules_a_callback_to_the_contract_itself() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[1].receiver_id, acct("taint.near"));
    match &receipts[1].actions[..] {
        [MockAction::FunctionCallWeight { method_name, .. }] => assert_eq!(method_name, b"on_payment"),
        other => panic!("expected the on_payment callback, got {other:?}"),
    }
}

fn after_payment(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acct("taint.near"))
            .predecessor_account_id(acct("taint.near"))
            .block_timestamp(T0 + 1)
            .account_balance(NearToken::from_yoctonear(1000 * NEAR))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

#[test]
fn a_failed_payment_gives_its_share_of_the_cap_back() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.remember_for_test("vendor.near");
    let prov = ArgProvenance { recipient: Some(untrusted("web")), token: None, amount: owner_prov() };
    assert!(matches!(c.propose(acct("owner.near"), transfer("vendor.near", NEAR / 2), prov, "f1".into()), ProposalOutcome::Executed { .. }));
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(NEAR / 2));
    assert_eq!(tn(&c).paid.get(&acct("vendor.near")).map(|v| v.len()), Some(1));

    after_payment(PromiseResult::Failed);
    c.on_payment(acct("owner.near"), U64(T0), U128(NEAR / 2), Some(acct("vendor.near")));
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(0));
    assert!(tn(&c).paid.is_empty());
}

#[test]
fn a_payment_that_went_through_keeps_counting() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    after_payment(PromiseResult::Successful(vec![]));
    c.on_payment(acct("owner.near"), U64(T0), U128(NEAR), None);
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(NEAR));
}

#[test]
fn a_failed_callback_only_returns_one_matching_payment() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f1".into());
    c.propose(acct("owner.near"), transfer("alice.near", NEAR), owner_transfer_prov(), "f2".into());
    after_payment(PromiseResult::Failed);
    c.on_payment(acct("owner.near"), U64(T0), U128(NEAR), None);
    assert_eq!(c.get_spent_24h(acct("owner.near")), U128(NEAR));
}

#[test]
#[should_panic(expected = "private")]
fn only_the_contract_itself_can_report_a_payment_result() {
    let mut c = setup();
    ctx("stranger.near", T0, 1000);
    c.on_payment(acct("owner.near"), U64(T0), U128(NEAR), None);
}

#[test]
fn unpinning_clears_what_the_account_vouched_for_from_storage() {
    let mut c = setup();
    c.pin_account(acct("acme.near"));
    ctx("acme.near", T0, 1000);
    c.register_payee_address(acct("owner.near"), acct("pay.near"));
    ctx("owner.near", T0, 1000);
    c.unpin_account(acct("acme.near"));
    assert!(tn(&c).payees.is_empty());
}

#[test]
fn only_the_admin_can_upgrade_the_code() {
    let c = setup();
    near_sdk::env::state_write(&c);
    let mut context = VMContextBuilder::new().current_account_id(acct("taint.near")).predecessor_account_id(acct("owner.near")).build();
    context.input = vec![0, 97, 115, 109].into();
    testing_env!(context);
    do_upgrade();
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, acct("taint.near"));
    match &receipts[0].actions[..] {
        [MockAction::DeployContract { code, .. }, MockAction::FunctionCallWeight { method_name, .. }] => {
            assert_eq!(code, &vec![0, 97, 115, 109]);
            assert_eq!(method_name, b"migrate");
        }
        other => panic!("expected deploy then migrate, got {other:?}"),
    }
}

#[test]
#[should_panic(expected = "admin only")]
fn a_stranger_cannot_upgrade_the_code() {
    let c = setup();
    near_sdk::env::state_write(&c);
    let mut context = VMContextBuilder::new().current_account_id(acct("taint.near")).predecessor_account_id(acct("worker.near")).build();
    context.input = vec![1].into();
    testing_env!(context);
    do_upgrade();
}

fn v2_for_test(next_id: u64) -> V2 {
    V2 {
        owner: acct("owner.near"),
        mockdex: acct("dex.near"),
        cfg: config(),
        workers: [acct("worker.near")].into_iter().collect(),
        book: BTreeMap::new(),
        pins: [acct("acme.near")].into_iter().collect(),
        payees: BTreeMap::new(),
        flows: LookupSet::new(b"f".to_vec()),
        pending: BTreeMap::new(),
        next_id,
        spent: vec![(T0, 5)],
        paid: BTreeMap::new(),
        paused: true,
    }
}

#[test]
fn migrate_turns_the_single_owner_state_into_the_first_account() {
    near_sdk::env::state_write(&v2_for_test(7));
    ctx("taint.near", T0, 1000);
    let m = Taint::migrate();
    assert_eq!(m.admin, acct("owner.near"));
    assert_eq!(m.count, 1);
    let t = m.tenants.get(&acct("owner.near")).unwrap();
    assert!(t.workers.contains(&acct("worker.near")));
    assert!(t.pins.contains(&acct("acme.near")));
    assert_eq!((t.next_id, t.spent.clone(), t.paused), (7, vec![(T0, 5)], true));
    assert!(t.balance > 0, "the first account is funded from the contract's spendable NEAR");
    assert_eq!(m.allocated, t.balance);
}

impl Taint {
    /// Test helper: a live address-book entry without going through the owner call.
    fn remember_for_test(&mut self, address: &str) {
        self.tenants.get_mut(&acct("owner.near")).unwrap().put_entry(acct(address), None, None, "owner".into());
    }
}

#[test]
fn migrate_leaves_state_that_is_already_current_exactly_as_it_is() {
    // `upgrade` always calls `migrate`, including when the new code has the same state layout as the old.
    let mut c = setup();
    c.pin_account(acct("acme.near"));
    {
        let t = tn_mut(&mut c);
        t.next_id = 12;
        t.spent.push((T0, 7));
        t.paid.insert(acct("vendor.near"), vec![(T0, 7)]);
    }
    c.tenants.flush();
    near_sdk::env::state_write(&c);
    ctx("taint.near", T0, 1000);
    let m = Taint::migrate();
    let t = m.tenants.get(&acct("owner.near")).unwrap();
    assert_eq!(t.next_id, 12);
    assert_eq!(t.spent, vec![(T0, 7)]);
    assert_eq!(t.paid.get(&acct("vendor.near")), Some(&vec![(T0, 7)]));
    assert!(t.pins.contains(&acct("acme.near")));
    assert!(t.workers.contains(&acct("worker.near")));
}

#[test]
#[should_panic(expected = "neither")]
fn migrate_refuses_state_it_does_not_recognise() {
    ctx("taint.near", T0, 1000);
    near_sdk::env::storage_write(b"STATE", &[1, 2, 3]);
    Taint::migrate();
}

// ---- one contract, many owners ----

fn open_account(c: &mut Taint, who: &str, near: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(acct(who))
        .block_timestamp(T0)
        .attached_deposit(NearToken::from_yoctonear(near * NEAR))
        .account_balance(NearToken::from_yoctonear(1000 * NEAR))
        .build());
    c.create_account(vec![acct("worker.near")]);
}

fn panic_text<R>(f: impl FnOnce() -> R) -> String {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    let e = match r {
        Ok(_) => panic!("expected a panic"),
        Err(e) => e,
    };
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

#[test]
fn an_account_needs_a_deposit_of_at_least_one_near_and_cannot_be_opened_twice() {
    let mut c = setup();
    assert!(panic_text(|| open_account(&mut c, "bob.near", 0)).contains("at least 1 NEAR"));
    open_account(&mut c, "bob.near", 2);
    assert!(panic_text(|| open_account(&mut c, "bob.near", 2)).contains("exists"));
}

#[test]
fn a_new_account_pays_for_its_own_storage_out_of_its_deposit() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 2);
    let view = c.get_account(acct("bob.near")).unwrap();
    assert!(view.balance.0 < 2 * NEAR && view.balance.0 > NEAR, "balance {}", view.balance.0);
}

#[test]
fn owners_do_not_share_books_pins_workers_or_caps() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 20);
    ctx("owner.near", T0, 1000);
    c.remember(acct("vendor.near"), None, None);
    c.pin_account(acct("acme.near"));
    assert_eq!(c.get_book(acct("owner.near")).len(), 1);
    assert!(c.get_book(acct("bob.near")).is_empty());
    assert!(c.get_pins(acct("bob.near")).is_empty());
    ctx("bob.near", T0, 1000);
    c.remove_worker(acct("worker.near"));
    assert!(!c.is_worker(acct("bob.near"), acct("worker.near")));
    assert!(c.is_worker(acct("owner.near"), acct("worker.near")));
}

#[test]
fn spending_by_one_owner_does_not_use_up_anothers_rolling_cap() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 20);
    ctx("worker.near", T0, 1000);
    let a = c.propose(acct("owner.near"), transfer("alice.near", 5 * NEAR), owner_transfer_prov(), "f1".into());
    assert!(matches!(a, ProposalOutcome::Executed { .. }));
    let b = c.propose(acct("bob.near"), transfer("alice.near", 5 * NEAR), owner_transfer_prov(), "f1".into());
    assert!(matches!(b, ProposalOutcome::Executed { .. }), "{b:?}");
}

#[test]
fn the_same_flow_hash_is_fine_for_two_owners_but_not_twice_for_one() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 20);
    ctx("worker.near", T0, 1000);
    c.propose(acct("owner.near"), transfer("alice.near", NEAR / 10), owner_transfer_prov(), "same".into());
    let bob = c.propose(acct("bob.near"), transfer("alice.near", NEAR / 10), owner_transfer_prov(), "same".into());
    assert!(matches!(bob, ProposalOutcome::Executed { .. }));
    let again = c.propose(acct("bob.near"), transfer("alice.near", NEAR / 10), owner_transfer_prov(), "same".into());
    assert_eq!(again, ProposalOutcome::Rejected { reason: "duplicate flow_hash".into() });
}

#[test]
fn an_owner_cannot_cosign_or_change_anothers_account() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 20);
    ctx("worker.near", T0, 1000);
    let ProposalOutcome::Pending { proposal_id, proposal_hash, .. } = c.propose(acct("bob.near"), transfer("n.near", NEAR / 2), held_prov(), "h1".into()) else {
        panic!("expected pending");
    };
    // owner.near has an account of their own, but a call acts only on the caller's account, where nothing is pending
    ctx("owner.near", T0, 1000);
    assert!(panic_text(|| c.cosign(proposal_id, proposal_hash.clone(), false)).contains("not pending"));
    // a stranger with no account at all gets "owner only"
    ctx("mallory.near", T0, 1000);
    assert!(panic_text(|| c.cosign(proposal_id, proposal_hash, false)).contains("owner only"));
}

#[test]
fn a_worker_the_owner_did_not_authorise_cannot_propose_for_them() {
    let mut c = setup();
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(acct("bob.near"))
        .block_timestamp(T0)
        .attached_deposit(NearToken::from_yoctonear(5 * NEAR))
        .account_balance(NearToken::from_yoctonear(1000 * NEAR))
        .build());
    c.create_account(vec![]);
    ctx("worker.near", T0, 1000);
    assert!(panic_text(|| c.propose(acct("bob.near"), transfer("alice.near", NEAR / 10), owner_transfer_prov(), "f1".into())).contains("worker only"));
}

#[test]
fn withdraw_moves_only_the_callers_balance() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 20);
    let (owner_before, bob_before) = (c.get_account(acct("owner.near")).unwrap().balance.0, c.get_account(acct("bob.near")).unwrap().balance.0);
    ctx("bob.near", T0, 1000);
    let _ = c.withdraw(acct("bob.near"), U128(5 * NEAR));
    assert_eq!(c.get_account(acct("bob.near")).unwrap().balance.0, bob_before - 5 * NEAR);
    assert_eq!(c.get_account(acct("owner.near")).unwrap().balance.0, owner_before);
    assert!(panic_text(|| c.withdraw(acct("bob.near"), U128(owner_before))).contains("insufficient"));
}

#[test]
fn only_the_admin_can_take_the_float_and_accounts_funds_are_not_in_it() {
    let mut c = setup();
    open_account(&mut c, "bob.near", 20);
    ctx("owner.near", T0, 1000); // owner.near is also the admin
    let float = c.get_float().0;
    assert!(panic_text(|| c.withdraw_float(acct("owner.near"), U128(float + 1))).contains("insufficient float"));
    ctx("bob.near", T0, 1000);
    assert!(panic_text(|| c.withdraw_float(acct("bob.near"), U128(1))).contains("admin only"));
}

#[test]
fn a_failed_payment_returns_the_money_to_the_owners_balance() {
    let mut c = setup();
    ctx("worker.near", T0, 1000);
    let before = tn(&c).balance;
    c.propose(acct("owner.near"), transfer("ghost.near", NEAR), owner_transfer_prov(), "f1".into());
    let after_pay = tn(&c).balance;
    assert!(after_pay < before);
    after_payment(PromiseResult::Failed);
    c.on_payment(acct("owner.near"), U64(T0), U128(NEAR), None);
    assert!(tn(&c).balance > after_pay, "refunded");
}

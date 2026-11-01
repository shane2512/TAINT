use crate::types::{ActionKind, ArgProvenance, ProposedAction, TrustClass};
use near_sdk::AccountId;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Decision {
    Execute,
    Pending(Vec<String>),
    Reject(String),
}

/// What the contract knows about counterparties. `now` is `block_timestamp` in nanoseconds.
pub trait PolicyView {
    /// Cap of a live (unexpired) address-book entry.
    fn book_cap(&self, address: &AccountId, now: u64) -> Option<u128>;
    /// Cap of a payee vouched for by a pinned account (the larger over all pinned registrants).
    fn payee_cap(&self, address: &AccountId, now: u64) -> Option<u128>;
}

/// The PRD section 7 table. Must stay identical to `MockContract.evaluate` in the TypeScript runtime;
/// `bench/policy-cases.json` is the shared test of that.
pub fn evaluate(view: &impl PolicyView, action: &ProposedAction, prov: &ArgProvenance, now: u64) -> Decision {
    let well_formed = match action.kind {
        ActionKind::Transfer => action.recipient.is_some() && action.token.is_none(),
        ActionKind::Swap => action.token.is_some() && action.recipient.is_none(),
    };
    // Provenance must be present for exactly the arguments the action has. A missing label must never read as
    // "trusted": an address with no provenance would otherwise skip the untrusted checks entirely.
    let prov_matches = action.recipient.is_some() == prov.recipient.is_some() && action.token.is_some() == prov.token.is_some();
    let amount = action.amount.0;
    if !well_formed || !prov_matches || amount == 0 {
        return Decision::Reject("malformed".into());
    }

    let mut reasons: Vec<String> = Vec::new();
    // The cap that covers an untrusted recipient; None when the recipient is owner-chosen or unknown.
    let mut cap: Option<u128> = None;

    if action.kind == ActionKind::Transfer {
        if let (Some(recipient), Some(p)) = (&action.recipient, &prov.recipient) {
            if p.class == TrustClass::Untrusted {
                cap = match (view.book_cap(recipient, now), view.payee_cap(recipient, now)) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (a, b) => a.or(b),
                };
                if cap.is_none() {
                    reasons.push(format!("recipient from {}", p.source));
                }
            }
        }
    }

    if action.kind == ActionKind::Swap {
        if let Some(p) = &prov.token {
            if p.class == TrustClass::Untrusted {
                reasons.push(format!("token from {}", p.source));
            }
        }
    }

    if prov.amount.class == TrustClass::Untrusted {
        if action.kind == ActionKind::Swap || cap.map_or(true, |c| amount > c) {
            reasons.push(format!("amount from {}", prov.amount.source));
        }
    } else if cap.map_or(false, |c| amount > c) {
        reasons.push("amount above entry cap".into());
    }

    if reasons.is_empty() {
        Decision::Execute
    } else {
        Decision::Pending(reasons)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Provenance;
    use near_sdk::json_types::U128;
    use std::collections::HashMap;

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    #[derive(Default)]
    struct FakeView {
        book: HashMap<AccountId, u128>,
        payee: HashMap<AccountId, u128>,
    }
    impl PolicyView for FakeView {
        fn book_cap(&self, a: &AccountId, _now: u64) -> Option<u128> {
            self.book.get(a).copied()
        }
        fn payee_cap(&self, a: &AccountId, _now: u64) -> Option<u128> {
            self.payee.get(a).copied()
        }
    }

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn owner() -> Provenance {
        Provenance { class: TrustClass::Owner, source: "owner".into() }
    }
    fn untrusted(src: &str) -> Provenance {
        Provenance { class: TrustClass::Untrusted, source: src.into() }
    }
    fn transfer(to: &str, amount: u128) -> ProposedAction {
        ProposedAction { kind: ActionKind::Transfer, recipient: Some(acct(to)), token: None, amount: U128(amount) }
    }
    fn swap(token: &str, amount: u128) -> ProposedAction {
        ProposedAction { kind: ActionKind::Swap, recipient: None, token: Some(acct(token)), amount: U128(amount) }
    }
    fn tprov(recipient: Provenance, amount: Provenance) -> ArgProvenance {
        ArgProvenance { recipient: Some(recipient), token: None, amount }
    }

    #[test]
    fn owner_transfer_executes() {
        let d = evaluate(&FakeView::default(), &transfer("alice.near", NEAR), &tprov(owner(), owner()), 0);
        assert_eq!(d, Decision::Execute);
    }

    #[test]
    fn untrusted_recipient_unknown_is_pending() {
        let p = tprov(untrusted("x.com/@attacker"), owner());
        let d = evaluate(&FakeView::default(), &transfer("attacker.near", NEAR), &p, 0);
        assert_eq!(d, Decision::Pending(vec!["recipient from x.com/@attacker".into()]));
    }

    #[test]
    fn untrusted_recipient_in_book_within_cap_executes() {
        let mut v = FakeView::default();
        v.book.insert(acct("alice.near"), NEAR);
        let d = evaluate(&v, &transfer("alice.near", NEAR / 2), &tprov(untrusted("web"), untrusted("web")), 0);
        assert_eq!(d, Decision::Execute);
    }

    #[test]
    fn untrusted_amount_over_book_cap_is_pending() {
        let mut v = FakeView::default();
        v.book.insert(acct("alice.near"), NEAR);
        let d = evaluate(&v, &transfer("alice.near", 2 * NEAR), &tprov(untrusted("web"), untrusted("x.com/@a")), 0);
        assert_eq!(d, Decision::Pending(vec!["amount from x.com/@a".into()]));
    }

    #[test]
    fn owner_amount_over_book_cap_with_untrusted_recipient_is_pending() {
        let mut v = FakeView::default();
        v.book.insert(acct("alice.near"), NEAR);
        let d = evaluate(&v, &transfer("alice.near", 2 * NEAR), &tprov(untrusted("web"), owner()), 0);
        assert_eq!(d, Decision::Pending(vec!["amount above entry cap".into()]));
    }

    #[test]
    fn coverage_is_the_larger_of_book_and_payee_cap() {
        let mut v = FakeView::default();
        v.book.insert(acct("friend.near"), 3 * NEAR);
        v.payee.insert(acct("friend.near"), NEAR / 2);
        let d = evaluate(&v, &transfer("friend.near", 2 * NEAR), &tprov(untrusted("email"), owner()), 0);
        assert_eq!(d, Decision::Execute);
    }

    #[test]
    fn untrusted_token_swap_is_pending() {
        let p = ArgProvenance { recipient: None, token: Some(untrusted("token-metadata:pump.fun")), amount: owner() };
        let d = evaluate(&FakeView::default(), &swap("newtoken.near", NEAR), &p, 0);
        assert_eq!(d, Decision::Pending(vec!["token from token-metadata:pump.fun".into()]));
    }

    #[test]
    fn owner_token_swap_executes() {
        let p = ArgProvenance { recipient: None, token: Some(owner()), amount: owner() };
        assert_eq!(evaluate(&FakeView::default(), &swap("newtoken.near", NEAR / 5), &p, 0), Decision::Execute);
    }

    #[test]
    fn swap_with_untrusted_amount_is_pending() {
        let p = ArgProvenance { recipient: None, token: Some(owner()), amount: untrusted("web") };
        let d = evaluate(&FakeView::default(), &swap("newtoken.near", NEAR), &p, 0);
        assert_eq!(d, Decision::Pending(vec!["amount from web".into()]));
    }

    #[test]
    fn owner_recipient_with_untrusted_amount_is_pending() {
        let d = evaluate(&FakeView::default(), &transfer("alice.near", NEAR), &tprov(owner(), untrusted("web")), 0);
        assert_eq!(d, Decision::Pending(vec!["amount from web".into()]));
    }

    #[test]
    fn unknown_recipient_and_untrusted_amount_report_both_in_order() {
        let d = evaluate(&FakeView::default(), &transfer("x.near", NEAR), &tprov(untrusted("a"), untrusted("b")), 0);
        assert_eq!(d, Decision::Pending(vec!["recipient from a".into(), "amount from b".into()]));
    }

    #[test]
    fn transfer_with_a_token_is_malformed() {
        let mut a = transfer("a.near", NEAR);
        a.token = Some(acct("t.near"));
        let p = ArgProvenance { recipient: Some(owner()), token: Some(owner()), amount: owner() };
        assert_eq!(evaluate(&FakeView::default(), &a, &p, 0), Decision::Reject("malformed".into()));
    }

    #[test]
    fn swap_with_a_recipient_is_malformed() {
        let mut a = swap("t.near", NEAR);
        a.recipient = Some(acct("a.near"));
        let p = ArgProvenance { recipient: Some(owner()), token: Some(owner()), amount: owner() };
        assert_eq!(evaluate(&FakeView::default(), &a, &p, 0), Decision::Reject("malformed".into()));
    }

    #[test]
    fn a_recipient_without_provenance_is_malformed_not_trusted() {
        let p = ArgProvenance { recipient: None, token: None, amount: owner() };
        let d = evaluate(&FakeView::default(), &transfer("attacker.near", NEAR), &p, 0);
        assert_eq!(d, Decision::Reject("malformed".into()));
    }

    #[test]
    fn a_token_without_provenance_is_malformed_not_trusted() {
        let p = ArgProvenance { recipient: None, token: None, amount: owner() };
        let d = evaluate(&FakeView::default(), &swap("newtoken.near", NEAR), &p, 0);
        assert_eq!(d, Decision::Reject("malformed".into()));
    }

    #[test]
    fn provenance_for_an_argument_the_action_lacks_is_malformed() {
        let p = ArgProvenance { recipient: Some(owner()), token: Some(owner()), amount: owner() };
        let d = evaluate(&FakeView::default(), &transfer("alice.near", NEAR), &p, 0);
        assert_eq!(d, Decision::Reject("malformed".into()));
    }

    #[test]
    fn zero_amount_is_malformed() {
        let d = evaluate(&FakeView::default(), &transfer("a.near", 0), &tprov(owner(), owner()), 0);
        assert_eq!(d, Decision::Reject("malformed".into()));
    }
}

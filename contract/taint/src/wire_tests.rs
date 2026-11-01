//! The TypeScript runtime and this contract talk JSON. These pin the exact shapes both sides rely on
//! (see `runtime/src/proposal.ts` and `runtime/src/near.ts`).

use crate::types::{ActionKind, ArgProvenance, ProposalOutcome, ProposedAction, TrustClass};
use near_sdk::serde_json::{self, json};

#[test]
fn it_accepts_the_action_json_the_typescript_client_sends() {
    let action: ProposedAction = serde_json::from_value(json!({
        "kind": "Transfer", "recipient": "alice.near", "token": null, "amount": "1500000000000000000000000"
    }))
    .unwrap();
    assert_eq!(action.kind, ActionKind::Transfer);
    assert_eq!(action.amount.0, 1_500_000_000_000_000_000_000_000);
    assert!(action.token.is_none());
}

#[test]
fn it_accepts_the_provenance_json_the_typescript_client_sends() {
    let prov: ArgProvenance = serde_json::from_value(json!({
        "recipient": { "class": "Untrusted", "source": "x.com/@attacker" },
        "token": null,
        "amount": { "class": "Owner", "source": "owner" }
    }))
    .unwrap();
    assert_eq!(prov.recipient.unwrap().class, TrustClass::Untrusted);
    assert_eq!(prov.amount.class, TrustClass::Owner);
}

#[test]
fn it_rejects_an_unknown_trust_class_instead_of_guessing() {
    assert!(serde_json::from_value::<ArgProvenance>(json!({
        "recipient": null, "token": null, "amount": { "class": "Trusted", "source": "x" }
    }))
    .is_err());
}

#[test]
fn it_refuses_an_amount_above_u128_max_at_the_json_layer() {
    // The shared rule table calls this "malformed"; in Rust the type itself cannot hold it.
    assert!(serde_json::from_value::<ProposedAction>(json!({
        "kind": "Transfer", "recipient": "alice.near", "token": null, "amount": "340282366920938463463374607431768211456"
    }))
    .is_err());
    assert!(serde_json::from_value::<ProposedAction>(json!({
        "kind": "Transfer", "recipient": "alice.near", "token": null, "amount": "340282366920938463463374607431768211455"
    }))
    .is_ok());
}

#[test]
fn it_rejects_an_amount_that_is_a_number_not_a_string() {
    assert!(serde_json::from_value::<ProposedAction>(json!({
        "kind": "Transfer", "recipient": "alice.near", "token": null, "amount": 5
    }))
    .is_err());
}

#[test]
fn it_emits_the_outcome_json_the_typescript_client_parses() {
    let executed = serde_json::to_value(ProposalOutcome::Executed { proposal_id: 7 }).unwrap();
    assert_eq!(executed, json!({ "Executed": { "proposal_id": 7 } }));

    let pending = serde_json::to_value(ProposalOutcome::Pending {
        proposal_id: 3,
        proposal_hash: "h".into(),
        reasons: vec!["recipient from x".into()],
    })
    .unwrap();
    assert_eq!(pending, json!({ "Pending": { "proposal_id": 3, "proposal_hash": "h", "reasons": ["recipient from x"] } }));

    let rejected = serde_json::to_value(ProposalOutcome::Rejected { reason: "global cap exceeded".into() }).unwrap();
    assert_eq!(rejected, json!({ "Rejected": { "reason": "global cap exceeded" } }));
}

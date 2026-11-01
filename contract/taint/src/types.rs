use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

/// Who decided a value. `Owner` means it appears in what the owner signed; everything else is `Untrusted`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrustClass {
    Owner,
    Untrusted,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Provenance {
    pub class: TrustClass,
    pub source: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActionKind {
    Transfer,
    Swap,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ProposedAction {
    pub kind: ActionKind,
    pub recipient: Option<AccountId>,
    pub token: Option<AccountId>,
    pub amount: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ArgProvenance {
    pub recipient: Option<Provenance>,
    pub token: Option<Provenance>,
    pub amount: Provenance,
}

/// JSON shape matches the TypeScript `ProposalOutcome`: `{"Executed":{"proposal_id":1}}` and so on.
#[near(serializers = [json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ProposalOutcome {
    Executed { proposal_id: u64 },
    Pending { proposal_id: u64, proposal_hash: String, reasons: Vec<String> },
    Rejected { reason: String },
}

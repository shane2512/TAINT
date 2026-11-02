//! taint.near: provenance-gated policy for an AI agent's wallet.
//!
//! The agent (a registered worker) proposes actions with per-argument provenance. Values the owner decided
//! execute within a rolling cap; values an outside party decided execute only if the owner already approved
//! the counterparty (address book) or a pinned named account vouched for it, otherwise they wait for the
//! owner's co-sign. The rules are `policy::evaluate`; `bench/policy-cases.json` is the shared test of them.

pub mod policy;
pub mod types;

use near_sdk::borsh::BorshDeserialize;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupSet;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use policy::{evaluate, Decision, PolicyView};
use std::collections::{BTreeMap, BTreeSet};
use types::{ActionKind, ArgProvenance, ProposalOutcome, ProposedAction, TrustClass};

const MS: u64 = 1_000_000;
const DAY_NS: u64 = 24 * 60 * 60 * 1000 * MS;
/// How long a held proposal can be co-signed.
const PENDING_TTL_NS: u64 = 15 * 60 * 1000 * MS;
/// Held proposals older than this are deleted on the next propose, so storage stays bounded.
const RETENTION_NS: u64 = DAY_NS;
const MAX_FLOW_HASH_LEN: usize = 64;
/// The worker chooses the source labels, and held proposals are stored: bound them so a leaked worker key
/// cannot lock the contract's balance in storage staking.
const MAX_SOURCE_LEN: usize = 128;
const MAX_PENDING: usize = 100;
const BUY_GAS: Gas = Gas::from_tgas(30);
/// Enough for `on_payment`, which only edits two small lists.
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const MIGRATE_GAS: Gas = Gas::from_tgas(100);
/// Payments kept in the rolling window. Every call walks this list, so a leaked worker key cannot make it so long
/// that the owner's own co-sign runs out of gas, or lock the balance in storage with a flood of 1-yocto payments.
const MAX_SPENT: usize = 1000;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    pub remember_cap: U128,
    pub remember_ttl_ns: U64,
    pub payee_cooldown_ns: U64,
    pub payee_cooldown_cap: U128,
    pub global_cap_24h: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct BookEntry {
    pub cap: U128,
    pub expires_at: U64,
    pub learned_from: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct PendingProposal {
    pub action: ProposedAction,
    pub prov: ArgProvenance,
    pub flow_hash: String,
    pub created_at: U64,
    pub hash: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Taint {
    owner: AccountId,
    mockdex: AccountId,
    cfg: Config,
    workers: BTreeSet<AccountId>,
    book: BTreeMap<AccountId, BookEntry>,
    pins: BTreeSet<AccountId>,
    /// payee address -> (account that registered it -> when)
    payees: BTreeMap<AccountId, BTreeMap<AccountId, u64>>,
    flows: LookupSet<String>,
    pending: BTreeMap<u64, PendingProposal>,
    next_id: u64,
    /// (time, amount) of everything executed in the rolling window
    spent: Vec<(u64, u128)>,
    /// What each address-book or payee cap has paid out in the window. Only a payment that cap itself allowed counts:
    /// the agent paying a recipient an outside party named. The owner's own co-signs and owner-chosen recipients do not.
    paid: BTreeMap<AccountId, Vec<(u64, u128)>>,
    paused: bool,
}

/// The state before `paid` existed. `migrate` reads this and writes the current layout.
#[near(serializers = [borsh])]
struct OldTaint {
    owner: AccountId,
    mockdex: AccountId,
    cfg: Config,
    workers: BTreeSet<AccountId>,
    book: BTreeMap<AccountId, BookEntry>,
    pins: BTreeSet<AccountId>,
    payees: BTreeMap<AccountId, BTreeMap<AccountId, u64>>,
    flows: LookupSet<String>,
    pending: BTreeMap<u64, PendingProposal>,
    next_id: u64,
    spent: Vec<(u64, u128)>,
    paused: bool,
}

#[near]
impl Taint {
    /// Must be called by the contract account itself, in the same batch as the deploy. Otherwise anyone
    /// watching the chain could call it first and become the owner.
    #[init]
    pub fn new(owner: AccountId, mockdex: AccountId, config: Config) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "init must be called by the contract account"
        );
        Self {
            owner,
            mockdex,
            cfg: config,
            workers: BTreeSet::new(),
            book: BTreeMap::new(),
            pins: BTreeSet::new(),
            payees: BTreeMap::new(),
            flows: LookupSet::new(b"f".to_vec()),
            pending: BTreeMap::new(),
            next_id: 1,
            spent: Vec::new(),
            paid: BTreeMap::new(),
            paused: false,
        }
    }

    /// Carries the state of the previous layout over. Only the contract itself can call it, which `upgrade` does
    /// right after deploying new code.
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "migrate is private");
        let bytes = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("no state to migrate"));
        // `upgrade` always calls this, including when the new code keeps the same layout: then there is nothing to do.
        if let Ok(current) = Taint::try_from_slice(&bytes) {
            return current;
        }
        let old = OldTaint::try_from_slice(&bytes).unwrap_or_else(|_| env::panic_str("state is neither the current nor the previous layout"));
        Self {
            owner: old.owner,
            mockdex: old.mockdex,
            cfg: old.cfg,
            workers: old.workers,
            book: old.book,
            pins: old.pins,
            payees: old.payees,
            flows: old.flows,
            pending: old.pending,
            next_id: old.next_id,
            spent: old.spent,
            paid: BTreeMap::new(),
            paused: old.paused,
        }
    }

    /// Called by this contract after a payment it scheduled. A payment that failed (a recipient account that does
    /// not exist, say) leaves the money here, so its share of the rolling cap and of the recipient's cap is returned.
    pub fn on_payment(&mut self, at: U64, amount: U128, counted_to: Option<AccountId>) {
        require!(env::predecessor_account_id() == env::current_account_id(), "on_payment is private");
        if !matches!(env::promise_result_checked(0, 1024), Err(near_sdk::PromiseError::Failed)) {
            return;
        }
        if let Some(i) = self.spent.iter().position(|e| *e == (at.0, amount.0)) {
            self.spent.remove(i);
        }
        if let Some(to) = counted_to {
            if let Some(list) = self.paid.get_mut(&to) {
                if let Some(i) = list.iter().position(|e| *e == (at.0, amount.0)) {
                    list.remove(i);
                }
                if list.is_empty() {
                    self.paid.remove(&to);
                }
            }
        }
    }

    // ---- owner ----

    pub fn register_worker(&mut self, worker: AccountId) {
        self.only_owner();
        self.workers.insert(worker);
    }

    /// Revoke a worker, for example one whose key leaked.
    pub fn remove_worker(&mut self, worker: AccountId) {
        self.only_owner();
        self.workers.remove(&worker);
    }

    /// While paused, no proposal is accepted and no payment is released (including by co-sign).
    /// The owner can still withdraw.
    pub fn set_paused(&mut self, paused: bool) {
        self.only_owner();
        self.paused = paused;
    }

    /// Take funds out. The owner's own authority, so it is not subject to the rolling cap (that cap exists to
    /// bound the worker). It leaves the storage-staking reserve in place.
    pub fn withdraw(&mut self, to: AccountId, amount: U128) -> Promise {
        self.only_owner();
        require!(NearToken::from_yoctonear(amount.0) <= self.spendable(), "insufficient balance");
        Promise::new(to).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn set_config(&mut self, config: Config) {
        self.only_owner();
        self.cfg = config;
    }

    /// Approve a counterparty. Defaults to the configured cap and lifetime.
    pub fn remember(&mut self, address: AccountId, cap: Option<U128>, ttl_ns: Option<U64>) {
        self.only_owner();
        self.put_entry(address, cap, ttl_ns, "owner".into());
    }

    pub fn forget(&mut self, address: AccountId) {
        self.only_owner();
        self.book.remove(&address);
    }

    pub fn pin_account(&mut self, account: AccountId) {
        self.only_owner();
        self.pins.insert(account);
    }

    /// Also forgets every payee the account vouched for, so pinning it again starts from nothing.
    pub fn unpin_account(&mut self, account: AccountId) {
        self.only_owner();
        self.pins.remove(&account);
        self.payees.retain(|_, by| {
            by.remove(&account);
            !by.is_empty()
        });
    }

    /// Approve a held proposal. In production this arrives as an NEP-366 delegate action signed by the owner.
    pub fn cosign(&mut self, proposal_id: u64, proposal_hash: String, remember: bool) -> ProposalOutcome {
        self.only_owner();
        let Some(p) = self.pending.get(&proposal_id).cloned() else { env::panic_str("not pending") };
        if p.hash != proposal_hash {
            env::panic_str("hash mismatch");
        }
        let now = env::block_timestamp();
        if now.saturating_sub(p.created_at.0) > PENDING_TTL_NS {
            env::panic_str("expired");
        }
        let out = self.execute(proposal_id, &p.action, None);
        if !matches!(out, ProposalOutcome::Executed { .. }) {
            return out; // e.g. the rolling cap: the proposal stays pending and can be retried within its TTL
        }
        self.pending.remove(&proposal_id);
        if let (true, Some(recipient)) = (remember, &p.action.recipient) {
            let prior = self.book.get(recipient).cloned();
            let source = p.prov.recipient.as_ref().map_or("owner".to_string(), |r| r.source.clone());
            self.put_entry(recipient.clone(), None, None, source);
            if let Some(prior) = prior.filter(|e| e.expires_at.0 > now) {
                // approve-and-remember must never weaken an entry the owner already set
                let entry = self.book.get_mut(recipient).unwrap();
                entry.cap = U128(entry.cap.0.max(prior.cap.0));
                entry.expires_at = U64(entry.expires_at.0.max(prior.expires_at.0));
            }
        }
        out
    }

    // ---- a pinned account vouching for a payment address ----

    /// Only pinned accounts may register a payee. This stops strangers filling the contract's storage.
    pub fn register_payee_address(&mut self, address: AccountId) {
        let by = env::predecessor_account_id();
        require!(self.pins.contains(&by), "pinned accounts only");
        self.payees.entry(address).or_default().insert(by, env::block_timestamp());
    }

    // ---- worker ----

    pub fn propose(&mut self, action: ProposedAction, prov: ArgProvenance, flow_hash: String) -> ProposalOutcome {
        require!(self.workers.contains(&env::predecessor_account_id()), "worker only");
        require!(flow_hash.len() <= MAX_FLOW_HASH_LEN, "flow_hash too long");
        for p in [&prov.recipient, &prov.token].into_iter().flatten().chain([&prov.amount]) {
            require!(p.source.len() <= MAX_SOURCE_LEN, "source too long");
        }
        if self.paused {
            // before the flow_hash is burned, so the same proposal can be retried after unpausing
            return ProposalOutcome::Rejected { reason: "paused".into() };
        }
        let now = env::block_timestamp();
        self.pending.retain(|_, p| now.saturating_sub(p.created_at.0) <= RETENTION_NS);

        // checked before anything else, and burned even if the proposal is then rejected
        if self.flows.contains(&flow_hash) {
            return ProposalOutcome::Rejected { reason: "duplicate flow_hash".into() };
        }
        self.flows.insert(flow_hash.clone());

        match evaluate(&*self, &action, &prov, now) {
            Decision::Reject(reason) => ProposalOutcome::Rejected { reason },
            Decision::Execute => {
                let id = self.take_id();
                // a payment to a recipient an outside party named is only allowed by that recipient's cap, so it uses it up
                let uses_cap = action.kind == ActionKind::Transfer && prov.recipient.as_ref().is_some_and(|p| p.class == TrustClass::Untrusted);
                let count_to = if uses_cap { action.recipient.clone() } else { None };
                self.execute(id, &action, count_to)
            }
            Decision::Pending(_) if self.pending.len() >= MAX_PENDING => {
                ProposalOutcome::Rejected { reason: "too many pending".into() }
            }
            Decision::Pending(reasons) => {
                let id = self.take_id();
                let bytes = near_sdk::borsh::to_vec(&(&action, &prov, &flow_hash)).unwrap();
                let hash = near_sdk::bs58::encode(env::sha256(&bytes)).into_string();
                self.pending.insert(
                    id,
                    PendingProposal { action, prov, flow_hash, created_at: U64(now), hash: hash.clone() },
                );
                ProposalOutcome::Pending { proposal_id: id, proposal_hash: hash, reasons }
            }
        }
    }

    // ---- views ----

    pub fn is_worker(&self, account: AccountId) -> bool {
        self.workers.contains(&account)
    }

    pub fn get_book(&self) -> Vec<(AccountId, BookEntry)> {
        self.book.iter().map(|(a, e)| (a.clone(), e.clone())).collect()
    }

    pub fn get_pins(&self) -> Vec<AccountId> {
        self.pins.iter().cloned().collect()
    }

    pub fn get_pending(&self) -> Vec<(u64, PendingProposal)> {
        let now = env::block_timestamp();
        self.pending
            .iter()
            .filter(|(_, p)| now.saturating_sub(p.created_at.0) <= PENDING_TTL_NS)
            .map(|(id, p)| (*id, p.clone()))
            .collect()
    }

    pub fn get_spent_24h(&self) -> U128 {
        let now = env::block_timestamp();
        U128(self.spent.iter().filter(|(ts, _)| now.saturating_sub(*ts) < DAY_NS).map(|(_, a)| a).sum())
    }
}

impl Taint {
    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    /// Balance that is not locked up backing the contract's storage.
    fn spendable(&self) -> NearToken {
        let reserve = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance().saturating_sub(reserve)
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn put_entry(&mut self, address: AccountId, cap: Option<U128>, ttl_ns: Option<U64>, learned_from: String) {
        let ttl = ttl_ns.unwrap_or(self.cfg.remember_ttl_ns).0;
        self.book.insert(
            address,
            BookEntry {
                cap: cap.unwrap_or(self.cfg.remember_cap),
                expires_at: U64(env::block_timestamp().saturating_add(ttl)),
                learned_from,
            },
        );
    }

    /// Enforce the rolling cap and the contract's balance, then schedule the payment.
    fn execute(&mut self, id: u64, action: &ProposedAction, count_to: Option<AccountId>) -> ProposalOutcome {
        if self.paused {
            return ProposalOutcome::Rejected { reason: "paused".into() };
        }
        let now = env::block_timestamp();
        let amount = action.amount.0;
        self.spent.retain(|(ts, _)| now.saturating_sub(*ts) < DAY_NS);
        self.paid.retain(|_, list| {
            list.retain(|(ts, _)| now.saturating_sub(*ts) < DAY_NS);
            !list.is_empty()
        });
        if self.spent.len() >= MAX_SPENT {
            return ProposalOutcome::Rejected { reason: "too many payments".into() };
        }
        let total: u128 = self.spent.iter().map(|(_, a)| a).sum();
        if total.checked_add(amount).map_or(true, |t| t > self.cfg.global_cap_24h.0) {
            return ProposalOutcome::Rejected { reason: "global cap exceeded".into() };
        }
        if self.spendable() < NearToken::from_yoctonear(amount) {
            return ProposalOutcome::Rejected { reason: "insufficient balance".into() };
        }
        self.spent.push((now, amount));
        if let Some(to) = &count_to {
            self.paid.entry(to.clone()).or_default().push((now, amount));
        }
        let deposit = NearToken::from_yoctonear(amount);
        let payment = match action.kind {
            ActionKind::Transfer => Promise::new(action.recipient.clone().unwrap()).transfer(deposit),
            ActionKind::Swap => {
                let args = near_sdk::serde_json::json!({ "token": action.token }).to_string().into_bytes();
                Promise::new(self.mockdex.clone()).function_call("buy".to_string(), args, deposit, BUY_GAS)
            }
        };
        let _ = payment.then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_payment(U64(now), U128(amount), count_to));
        ProposalOutcome::Executed { proposal_id: id }
    }
}

impl PolicyView for Taint {
    fn book_cap(&self, address: &AccountId, now: u64) -> Option<u128> {
        self.book.get(address).filter(|e| e.expires_at.0 > now).map(|e| e.cap.0)
    }

    fn paid_24h(&self, address: &AccountId, now: u64) -> u128 {
        self.paid.get(address).map_or(0, |l| l.iter().filter(|(ts, _)| now.saturating_sub(*ts) < DAY_NS).map(|(_, a)| a).sum())
    }

    fn payee_cap(&self, address: &AccountId, now: u64) -> Option<u128> {
        self.payees
            .get(address)?
            .iter()
            .filter(|(by, _)| self.pins.contains(*by))
            .map(|(_, at)| {
                if now.saturating_sub(*at) < self.cfg.payee_cooldown_ns.0 {
                    self.cfg.payee_cooldown_cap.0
                } else {
                    self.cfg.global_cap_24h.0
                }
            })
            .max()
    }
}

/// Replaces the contract's code with the bytes it is called with, then migrates the state. The owner's call, so the
/// rules can change only with the owner's say-so even once the contract account has no key of its own.
#[no_mangle]
pub extern "C" fn upgrade() {
    env::setup_panic_hook();
    do_upgrade();
}

fn do_upgrade() {
    let contract: Taint = env::state_read().unwrap_or_else(|| env::panic_str("no state"));
    contract.only_owner();
    let code = env::input().unwrap_or_else(|| env::panic_str("no code"));
    let _ = Promise::new(env::current_account_id())
        .deploy_contract(code)
        .function_call("migrate".to_string(), Vec::new(), NearToken::from_yoctonear(0), MIGRATE_GAS)
        .as_return();
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod wire_tests;

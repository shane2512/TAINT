//! taint.near: provenance-gated policy for AI agents' wallets, one account per owner.
//!
//! Every owner has their own `Tenant`: balance, workers (their agents), address book, pins, caps and held
//! proposals. A worker proposes actions with per-argument provenance. Values the owner decided execute within
//! a rolling cap; values an outside party decided execute only if the owner already approved the counterparty
//! (address book) or a pinned named account vouched for it, otherwise they wait for the owner's co-sign.
//! The rules are `policy::evaluate`; `bench/policy-cases.json` is the shared test of them.
//! The `admin` (the deployer's owner account) upgrades the contract and approves worker attestations; it has
//! no power over a tenant's funds.

pub mod policy;
pub mod types;
pub mod attest;

use near_sdk::borsh::BorshDeserialize;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use attest::{AttestState, Ppid, Real, Verifier};
use policy::{evaluate, Decision, PolicyView};
use shade_attestation::attestation::DstackAttestation;
use shade_attestation::measurements::FullMeasurementsHex;
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
/// Storage a registration is expected to use; the registering worker attaches at least this much.
const REGISTER_BYTES: u128 = 700;
/// An account must deposit at least this much, which also pays for the storage it uses.
const MIN_DEPOSIT: u128 = 1_000_000_000_000_000_000_000_000;
/// The contract fronts nothing but the first bytes of the map; this bounds how many accounts exist.
const MAX_TENANTS: u32 = 500;

#[near(serializers = [json])]
pub struct AgentView {
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    pub valid_until_ms: U64,
    /// False once expired or once the owner has withdrawn an approval it depended on.
    pub valid: bool,
}

#[near(serializers = [json])]
pub struct AttestationView {
    pub require_tee: bool,
    pub expiry_ms: U64,
    pub approved_measurements: Vec<FullMeasurementsHex>,
    pub approved_ppids: Vec<Ppid>,
    pub agents: Vec<(AccountId, AgentView)>,
}

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

/// One owner's account. Not the contract state: the contract keeps one of these per owner.
#[near(serializers = [borsh])]
pub struct Tenant {
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
    /// What this owner has in the contract, after the storage their account uses. Payments come out of it.
    balance: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Taint {
    admin: AccountId,
    mockdex: AccountId,
    /// What a new account starts with. Each owner can change their own.
    cfg: Config,
    tenants: LookupMap<AccountId, Tenant>,
    count: u32,
    /// Sum of every tenant's balance; the rest of the contract's NEAR is the admin's float for storage.
    allocated: u128,
}

/// The single-owner state that was deployed before accounts existed. `migrate` reads it and writes the current layout.
#[near(serializers = [borsh])]
struct V2 {
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
    paid: BTreeMap<AccountId, Vec<(u64, u128)>>,
    paused: bool,
}

/// What a client needs to show an account.
#[near(serializers = [json])]
pub struct AccountView {
    pub balance: U128,
    pub paused: bool,
    pub workers: Vec<AccountId>,
    pub config: Config,
}

#[near]
impl Taint {
    /// Must be called by the contract account itself, in the same batch as the deploy. Otherwise anyone
    /// watching the chain could call it first and become the admin.
    #[init]
    pub fn new(admin: AccountId, mockdex: AccountId, config: Config) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "init must be called by the contract account"
        );
        Self { admin, mockdex, cfg: config, tenants: LookupMap::new(b"t".to_vec()), count: 0, allocated: 0 }
    }

    /// Carries the state of the previous layout over. Only the contract itself can call it, which `upgrade` does
    /// right after deploying new code. The one owner of the single-owner layout becomes the first account and the
    /// admin; half of the contract's spendable NEAR becomes that account's balance and the rest stays as float.
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "migrate is private");
        let bytes = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("no state to migrate"));
        // `upgrade` always calls this, including when the new code keeps the same layout: then there is nothing to do.
        if let Ok(current) = Taint::try_from_slice(&bytes) {
            return current;
        }
        let old = V2::try_from_slice(&bytes).unwrap_or_else(|_| env::panic_str("state is neither the current nor the previous layout"));
        let reserve = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        let balance = env::account_balance().saturating_sub(reserve).as_yoctonear() / 2;
        let mut tenants = LookupMap::new(b"t".to_vec());
        let owner = old.owner.clone();
        tenants.insert(
            owner.clone(),
            Tenant {
                owner: old.owner.clone(),
                mockdex: old.mockdex.clone(),
                cfg: old.cfg.clone(),
                workers: old.workers,
                book: old.book,
                pins: old.pins,
                payees: old.payees,
                flows: old.flows,
                pending: old.pending,
                next_id: old.next_id,
                spent: old.spent,
                paid: old.paid,
                paused: old.paused,
                balance,
            },
        );
        Self { admin: owner, mockdex: old.mockdex, cfg: old.cfg, tenants, count: 1, allocated: balance }
    }

    /// Called by this contract after a payment it scheduled. A payment that failed (a recipient account that does
    /// not exist, say) leaves the money here, so it goes back to the owner's balance and its share of the rolling
    /// cap and of the recipient's cap is returned.
    pub fn on_payment(&mut self, owner: AccountId, at: U64, amount: U128, counted_to: Option<AccountId>) {
        require!(env::predecessor_account_id() == env::current_account_id(), "on_payment is private");
        if !matches!(env::promise_result_checked(0, 1024), Err(near_sdk::PromiseError::Failed)) {
            return;
        }
        self.apply(&owner, |t| t.payment_failed(at.0, amount.0, counted_to));
    }

    // ---- accounts ----

    /// Open an account for the caller, who becomes its owner. The attached NEAR is the balance, less the storage the
    /// account uses. `workers` are the agent accounts the owner authorises to propose for them.
    #[payable]
    pub fn create_account(&mut self, workers: Vec<AccountId>) {
        let owner = env::predecessor_account_id();
        require!(!self.tenants.contains_key(&owner), "account exists");
        require!(self.count < MAX_TENANTS, "too many accounts");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= MIN_DEPOSIT, "attach at least 1 NEAR");
        let before = env::storage_usage();
        let tenant = Tenant::open(owner.clone(), self.mockdex.clone(), self.cfg.clone(), workers, deposit);
        self.tenants.insert(owner.clone(), tenant);
        self.tenants.flush();
        self.count += 1;
        self.allocated += deposit;
        self.settle_storage(&owner, before);
    }

    #[payable]
    pub fn deposit(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        self.apply(&env::predecessor_account_id(), |t| t.balance += amount);
    }

    /// Take funds out of the caller's balance. The owner's own authority, so it is not subject to the rolling cap
    /// (that cap exists to bound the worker).
    pub fn withdraw(&mut self, to: AccountId, amount: U128) -> Promise {
        self.owner_call(|t| {
            t.only_owner();
            require!(amount.0 <= t.balance, "insufficient balance");
            t.balance -= amount.0;
        });
        Promise::new(to).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ---- owner (each acts on the caller's own account) ----

    pub fn register_worker(&mut self, worker: AccountId) {
        self.owner_call(|t| {
            t.workers.insert(worker);
        });
    }

    /// Revoke a worker, for example one whose key leaked.
    pub fn remove_worker(&mut self, worker: AccountId) {
        self.owner_call(|t| {
            t.workers.remove(&worker);
        });
    }

    /// While paused, no proposal is accepted and no payment is released (including by co-sign).
    /// The owner can still withdraw.
    pub fn set_paused(&mut self, paused: bool) {
        self.owner_call(|t| t.paused = paused);
    }

    pub fn set_config(&mut self, config: Config) {
        self.owner_call(|t| t.cfg = config);
    }

    /// Approve a counterparty. Defaults to the configured cap and lifetime.
    pub fn remember(&mut self, address: AccountId, cap: Option<U128>, ttl_ns: Option<U64>) {
        self.owner_call(|t| t.put_entry(address, cap, ttl_ns, "owner".into()));
    }

    pub fn forget(&mut self, address: AccountId) {
        self.owner_call(|t| {
            t.book.remove(&address);
        });
    }

    pub fn pin_account(&mut self, account: AccountId) {
        self.owner_call(|t| {
            t.pins.insert(account);
        });
    }

    /// Also forgets every payee the account vouched for, so pinning it again starts from nothing.
    pub fn unpin_account(&mut self, account: AccountId) {
        self.owner_call(|t| {
            t.pins.remove(&account);
            t.payees.retain(|_, by| {
                by.remove(&account);
                !by.is_empty()
            });
        });
    }

    /// Approve a held proposal. In production this arrives as an NEP-366 delegate action signed by the owner.
    pub fn cosign(&mut self, proposal_id: u64, proposal_hash: String, remember: bool) -> ProposalOutcome {
        self.owner_call(|t| t.cosign(proposal_id, proposal_hash, remember))
    }

    // ---- a pinned account vouching for a payment address ----

    /// Only accounts the owner pinned may register a payee. This stops strangers filling the contract's storage.
    pub fn register_payee_address(&mut self, owner: AccountId, address: AccountId) {
        let by = env::predecessor_account_id();
        self.apply(&owner, |t| {
            require!(t.pins.contains(&by), "pinned accounts only");
            t.payees.entry(address).or_default().insert(by, env::block_timestamp());
        });
    }

    // ---- worker ----

    pub fn propose(&mut self, owner: AccountId, action: ProposedAction, prov: ArgProvenance, flow_hash: String) -> ProposalOutcome {
        self.apply(&owner, |t| t.propose(action, prov, flow_hash))
    }

    // ---- admin: upgrades and worker attestation (see attest.rs) ----

    /// Approve a set of code measurements. A worker has to be running exactly this code to register.
    pub fn approve_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.only_admin();
        let mut s = AttestState::load();
        s.approve_measurements(measurements);
        s.save();
    }

    /// Withdrawing an approval also revokes the workers that depended on it, the next time they are used.
    pub fn remove_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.only_admin();
        let mut s = AttestState::load();
        s.remove_measurements(&measurements);
        s.save();
    }

    /// Approve the hardware (Intel PPID) workers may run on.
    pub fn approve_ppids(&mut self, ppids: Vec<Ppid>) {
        self.only_admin();
        let mut s = AttestState::load();
        s.approve_ppids(ppids);
        s.save();
    }

    pub fn remove_ppids(&mut self, ppids: Vec<Ppid>) {
        self.only_admin();
        let mut s = AttestState::load();
        s.remove_ppids(&ppids);
        s.save();
    }

    /// When on, a plain owner-registered worker key stops counting: only attested workers can propose.
    pub fn set_require_tee(&mut self, require_tee: bool) {
        self.only_admin();
        let mut s = AttestState::load();
        s.require_tee = require_tee;
        s.save();
    }

    /// How long a registration lasts. 0 restores the default of 24 hours.
    pub fn set_attestation_expiry_ms(&mut self, expiry_ms: U64) {
        self.only_admin();
        let mut s = AttestState::load();
        s.expiry_ms = expiry_ms.0;
        s.save();
    }

    pub fn remove_agent(&mut self, account_id: AccountId) {
        self.only_admin();
        let mut s = AttestState::load();
        s.agents.remove(&account_id);
        s.save();
    }

    /// Called by the worker itself, from the implicit account whose key the TEE generated. Needs roughly 300 Tgas, and a
    /// deposit that covers the storage of the registration.
    #[payable]
    pub fn register_attested_worker(&mut self, attestation: DstackAttestation) -> bool {
        self.register_with(attestation, &Real)
    }

    /// What a new account starts with.
    pub fn set_default_config(&mut self, config: Config) {
        self.only_admin();
        self.cfg = config;
    }

    /// The admin's float: NEAR the contract holds that no account owns. It backs the storage of the contract itself.
    pub fn withdraw_float(&mut self, to: AccountId, amount: U128) -> Promise {
        self.only_admin();
        require!(NearToken::from_yoctonear(amount.0) <= self.float(), "insufficient float");
        Promise::new(to).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ---- views ----

    pub fn has_account(&self, owner: AccountId) -> bool {
        self.tenants.contains_key(&owner)
    }

    pub fn get_account(&self, owner: AccountId) -> Option<AccountView> {
        self.tenants.get(&owner).map(|t| AccountView { balance: U128(t.balance), paused: t.paused, workers: t.workers.iter().cloned().collect(), config: t.cfg.clone() })
    }

    pub fn is_worker(&self, owner: AccountId, account: AccountId) -> bool {
        self.tenants.get(&owner).is_some_and(|t| t.is_active_worker(&account))
    }

    pub fn get_attestation(&self) -> AttestationView {
        let s = AttestState::load();
        let now = env::block_timestamp_ms();
        AttestationView {
            require_tee: s.require_tee,
            expiry_ms: U64(s.expiry()),
            agents: s
                .agents
                .iter()
                .map(|(id, a)| (id.clone(), AgentView { measurements: a.measurements.clone(), ppid: a.ppid.clone(), valid_until_ms: U64(a.valid_until_ms), valid: s.is_valid(id, now) }))
                .collect(),
            approved_measurements: s.measurements,
            approved_ppids: s.ppids,
        }
    }

    pub fn get_book(&self, owner: AccountId) -> Vec<(AccountId, BookEntry)> {
        self.tenants.get(&owner).map_or_else(Vec::new, |t| t.book.iter().map(|(a, e)| (a.clone(), e.clone())).collect())
    }

    pub fn get_pins(&self, owner: AccountId) -> Vec<AccountId> {
        self.tenants.get(&owner).map_or_else(Vec::new, |t| t.pins.iter().cloned().collect())
    }

    pub fn get_pending(&self, owner: AccountId) -> Vec<(u64, PendingProposal)> {
        let now = env::block_timestamp();
        self.tenants.get(&owner).map_or_else(Vec::new, |t| {
            t.pending.iter().filter(|(_, p)| now.saturating_sub(p.created_at.0) <= PENDING_TTL_NS).map(|(id, p)| (*id, p.clone())).collect()
        })
    }

    pub fn get_spent_24h(&self, owner: AccountId) -> U128 {
        let now = env::block_timestamp();
        U128(self.tenants.get(&owner).map_or(0, |t| t.spent.iter().filter(|(ts, _)| now.saturating_sub(*ts) < DAY_NS).map(|(_, a)| a).sum()))
    }

    pub fn get_float(&self) -> U128 {
        U128(self.float().as_yoctonear())
    }
}

impl Taint {
    fn only_admin(&self) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
    }

    /// NEAR the contract holds beyond what accounts own and the storage everything uses.
    fn float(&self) -> NearToken {
        let reserve = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance().saturating_sub(reserve).saturating_sub(NearToken::from_yoctonear(self.allocated))
    }

    /// Run `f` on the account `owner`, keep the result, and charge or credit the account for the storage it now uses.
    fn apply<R>(&mut self, owner: &AccountId, f: impl FnOnce(&mut Tenant) -> R) -> R {
        let Some(t) = self.tenants.get_mut(owner) else { env::panic_str("no account") };
        let (balance_before, before) = (t.balance, env::storage_usage());
        let r = f(t);
        // `f` may have moved the balance (a payment, a refund, a deposit): keep the total in step
        self.allocated = (self.allocated as i128 + t.balance as i128 - balance_before as i128) as u128;
        self.tenants.flush();
        self.settle_storage(owner, before);
        r
    }

    /// An owner-only call on the caller's own account. Panics "owner only" if the caller has none.
    fn owner_call<R>(&mut self, f: impl FnOnce(&mut Tenant) -> R) -> R {
        let who = env::predecessor_account_id();
        if !self.tenants.contains_key(&who) {
            env::panic_str("owner only: no account");
        }
        self.apply(&who, |t| {
            t.only_owner();
            f(t)
        })
    }

    /// The account pays for the bytes it added since `before` (or gets back the ones it freed).
    fn settle_storage(&mut self, owner: &AccountId, before: u64) {
        let now = env::storage_usage();
        let cost = |bytes: u64| env::storage_byte_cost().saturating_mul(bytes as u128).as_yoctonear();
        let t = self.tenants.get_mut(owner).unwrap();
        if now >= before {
            let c = cost(now - before);
            require!(t.balance >= c, "the balance cannot cover the storage this needs");
            t.balance -= c;
            self.allocated = self.allocated.saturating_sub(c);
        } else {
            let c = cost(before - now);
            t.balance += c;
            self.allocated += c;
        }
        self.tenants.flush();
    }

    fn register_with(&mut self, attestation: DstackAttestation, verifier: &impl Verifier) -> bool {
        let storage = env::storage_byte_cost().saturating_mul(REGISTER_BYTES);
        require!(env::attached_deposit() >= storage, "attach a deposit that covers the storage of the registration");
        let mut s = AttestState::load();
        if let Err(e) = s.register(&env::predecessor_account_id(), &attestation, env::block_timestamp_ms(), verifier) {
            env::panic_str(&e);
        }
        s.save();
        true
    }
}

impl Tenant {
    fn open(owner: AccountId, mockdex: AccountId, cfg: Config, workers: Vec<AccountId>, balance: u128) -> Self {
        let mut prefix = b"F".to_vec();
        prefix.extend_from_slice(owner.as_bytes());
        prefix.push(b'/');
        Self {
            owner,
            mockdex,
            cfg,
            workers: workers.into_iter().collect(),
            book: BTreeMap::new(),
            pins: BTreeSet::new(),
            payees: BTreeMap::new(),
            flows: LookupSet::new(prefix),
            pending: BTreeMap::new(),
            next_id: 1,
            spent: Vec::new(),
            paid: BTreeMap::new(),
            paused: false,
            balance,
        }
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    /// An owner-registered key (unless TEE is required) or a worker whose attestation is current.
    fn is_active_worker(&self, who: &AccountId) -> bool {
        let s = AttestState::load();
        (!s.require_tee && self.workers.contains(who)) || s.is_valid(who, env::block_timestamp_ms())
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
            BookEntry { cap: cap.unwrap_or(self.cfg.remember_cap), expires_at: U64(env::block_timestamp().saturating_add(ttl)), learned_from },
        );
    }

    fn payment_failed(&mut self, at: u64, amount: u128, counted_to: Option<AccountId>) {
        self.balance += amount;
        if let Some(i) = self.spent.iter().position(|e| *e == (at, amount)) {
            self.spent.remove(i);
        }
        if let Some(to) = counted_to {
            if let Some(list) = self.paid.get_mut(&to) {
                if let Some(i) = list.iter().position(|e| *e == (at, amount)) {
                    list.remove(i);
                }
                if list.is_empty() {
                    self.paid.remove(&to);
                }
            }
        }
    }

    fn cosign(&mut self, proposal_id: u64, proposal_hash: String, remember: bool) -> ProposalOutcome {
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

    fn propose(&mut self, action: ProposedAction, prov: ArgProvenance, flow_hash: String) -> ProposalOutcome {
        require!(self.is_active_worker(&env::predecessor_account_id()), "worker only");
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
                self.pending.insert(id, PendingProposal { action, prov, flow_hash, created_at: U64(now), hash: hash.clone() });
                ProposalOutcome::Pending { proposal_id: id, proposal_hash: hash, reasons }
            }
        }
    }

    /// Enforce the rolling cap and the owner's balance, then schedule the payment.
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
        if self.balance < amount {
            return ProposalOutcome::Rejected { reason: "insufficient balance".into() };
        }
        self.balance -= amount;
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
        let _ = payment.then(Taint::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_payment(self.owner.clone(), U64(now), U128(amount), count_to));
        ProposalOutcome::Executed { proposal_id: id }
    }
}

impl PolicyView for Tenant {
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

/// Replaces the contract's code with the bytes it is called with, then migrates the state. The admin's call, so the
/// rules can change only with the admin's say-so even once the contract account has no key of its own.
#[no_mangle]
pub extern "C" fn upgrade() {
    env::setup_panic_hook();
    do_upgrade();
}

fn do_upgrade() {
    // The state may still be the previous layout: read the admin from whichever layout is there.
    let bytes = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("no state"));
    let admin = match Taint::try_from_slice(&bytes) {
        Ok(c) => c.admin,
        Err(_) => V2::try_from_slice(&bytes).unwrap_or_else(|_| env::panic_str("unreadable state")).owner,
    };
    require!(env::predecessor_account_id() == admin, "admin only");
    let code = env::input().unwrap_or_else(|| env::panic_str("no code"));
    let _ = Promise::new(env::current_account_id())
        .deploy_contract(code)
        .function_call("migrate".to_string(), Vec::new(), NearToken::from_yoctonear(0), MIGRATE_GAS)
        .as_return();
}

#[cfg(test)]
mod attest_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod wire_tests;

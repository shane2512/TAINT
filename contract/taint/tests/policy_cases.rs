//! Runs bench/policy-cases.json, the rule table the TypeScript MockContract also runs.
//! If the two ever disagree, one of them is wrong about the rules.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use taint::types::{ActionKind, ArgProvenance, ProposalOutcome, ProposedAction, Provenance, TrustClass};
use taint::{Config, Taint};

const MS: u64 = 1_000_000;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// "1.5" -> yocto
fn near_to_yocto(s: &str) -> u128 {
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let frac = format!("{:0<24}", frac);
    whole.parse::<u128>().unwrap() * NEAR + frac.parse::<u128>().unwrap()
}

fn ctx(predecessor: &str, now_ns: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("taint.near"))
        .predecessor_account_id(acct(predecessor))
        .block_timestamp(now_ns)
        .account_balance(NearToken::from_near(1_000_000_000))
        .build());
}

fn prov(v: &Value) -> Option<Provenance> {
    v.as_str().map(|s| {
        if s == "owner" {
            Provenance { class: TrustClass::Owner, source: "owner".into() }
        } else {
            Provenance { class: TrustClass::Untrusted, source: s.into() }
        }
    })
}

fn check(out: &ProposalOutcome, expect: &Value, label: &str) {
    if expect.get("Executed").is_some() {
        assert!(matches!(out, ProposalOutcome::Executed { .. }), "{label}: {out:?}");
    } else if let Some(reasons) = expect.get("Pending") {
        let want: Vec<String> = reasons.as_array().unwrap().iter().map(|r| r.as_str().unwrap().to_string()).collect();
        match out {
            ProposalOutcome::Pending { reasons, .. } => assert_eq!(reasons, &want, "{label}"),
            other => panic!("{label}: expected pending, got {other:?}"),
        }
    } else {
        let want = expect["Rejected"].as_str().unwrap();
        assert_eq!(out, &ProposalOutcome::Rejected { reason: want.into() }, "{label}");
    }
}

fn run_case(table: &Value, case: &Value) {
    let c = &table["config"];
    let cfg = Config {
        remember_cap: U128(near_to_yocto(c["rememberCapNear"].as_str().unwrap())),
        remember_ttl_ns: U64(c["rememberTtlMs"].as_u64().unwrap() * MS),
        payee_cooldown_ns: U64(c["payeeCooldownMs"].as_u64().unwrap() * MS),
        payee_cooldown_cap: U128(near_to_yocto(c["payeeCooldownCapNear"].as_str().unwrap())),
        global_cap_24h: U128(near_to_yocto(c["globalCap24hNear"].as_str().unwrap())),
    };
    let mut now = 1_000_000 * MS;
    ctx("taint.near", now); // init must come from the contract account itself
    let mut contract = Taint::new(acct("owner.near"), acct("dex.near"), cfg);
    ctx("owner.near", now);
    contract.register_worker(acct("worker.near"));

    let mut created: HashMap<String, (u64, String)> = HashMap::new();
    let mut n = 0;
    for s in case["steps"].as_array().unwrap() {
        let op = s["op"].as_str().unwrap();
        match op {
            "advance" => now += s["ms"].as_u64().unwrap() * MS,
            "remember" => {
                ctx("owner.near", now);
                let cap = s.get("capNear").and_then(|v| v.as_str()).map(|v| U128(near_to_yocto(v)));
                let ttl = s.get("ttlMs").and_then(|v| v.as_u64()).map(|v| U64(v * MS));
                contract.remember(acct(s["address"].as_str().unwrap()), cap, ttl);
            }
            "pin" => {
                ctx("owner.near", now);
                contract.pin_account(acct(s["account"].as_str().unwrap()));
            }
            "unpin" => {
                ctx("owner.near", now);
                contract.unpin_account(acct(s["account"].as_str().unwrap()));
            }
            "registerPayee" => {
                ctx(s["by"].as_str().unwrap(), now);
                contract.register_payee_address(acct(s["address"].as_str().unwrap()));
            }
            "propose" => {
                let a = &s["action"];
                let kind = if a["kind"] == "Transfer" { ActionKind::Transfer } else { ActionKind::Swap };
                let yocto = match a.get("amountYocto").and_then(|v| v.as_str()) {
                    Some(y) => y.parse::<u128>().ok(),
                    None => Some(near_to_yocto(a["amountNear"].as_str().unwrap())),
                };
                let id = s["id"].as_str().unwrap().to_string();
                let expect = &s["expect"];
                let Some(yocto) = yocto else {
                    // An amount above u128 max cannot even be represented by the contract's U128 argument:
                    // the JSON layer refuses it, which is this table's "malformed".
                    assert_eq!(expect["Rejected"], "malformed", "{id}");
                    continue;
                };
                let action = ProposedAction {
                    kind,
                    recipient: a.get("recipient").and_then(|v| v.as_str()).map(acct),
                    token: a.get("token").and_then(|v| v.as_str()).map(acct),
                    amount: U128(yocto),
                };
                let p = &s["prov"];
                let ap = ArgProvenance {
                    recipient: prov(&p["recipient"]),
                    token: prov(&p["token"]),
                    amount: prov(&p["amount"]).unwrap(),
                };
                let flow = s.get("flow").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| {
                    n += 1;
                    format!("flow:{id}:{n}")
                });
                ctx("worker.near", now);
                let out = contract.propose(action, ap, flow);
                check(&out, expect, &id);
                if let ProposalOutcome::Pending { proposal_id, proposal_hash, .. } = &out {
                    created.insert(id, (*proposal_id, proposal_hash.clone()));
                }
            }
            "cosign" => {
                let (pid, hash) = created[s["of"].as_str().unwrap()].clone();
                let hash = if s["hash"] == "ok" { hash } else { "wrong".to_string() };
                let remember = s["remember"].as_bool().unwrap();
                ctx("owner.near", now);
                let expect = &s["expect"];
                if let Some(msg) = expect.get("throws").and_then(|v| v.as_str()) {
                    let r = catch_unwind(AssertUnwindSafe(|| contract.cosign(pid, hash, remember)));
                    let err = r.expect_err("expected a panic");
                    let text = err.downcast_ref::<String>().cloned().or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                    assert!(text.contains(msg), "expected panic containing {msg:?}, got {text:?}");
                } else {
                    let out = contract.cosign(pid, hash, remember);
                    check(&out, expect, &format!("cosign {}", s["of"]));
                }
            }
            other => panic!("unknown op {other}"),
        }
    }
}

#[test]
fn the_shared_policy_rule_table_passes() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../bench/policy-cases.json");
    let table: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = table["cases"].as_array().unwrap();
    assert!(cases.len() >= 15);
    let mut failed = Vec::new();
    for case in cases {
        let name = case["name"].as_str().unwrap().to_string();
        // One thread per case: the mocked blockchain's storage is thread-local and survives `testing_env!`,
        // so cases sharing a thread would see each other's flow_hashes.
        let (t, c) = (table.clone(), case.clone());
        if std::thread::spawn(move || run_case(&t, &c)).join().is_err() {
            failed.push(name);
        }
    }
    assert!(failed.is_empty(), "cases that failed: {failed:#?}");
}

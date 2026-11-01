//! mockdex: a testnet stand-in for a DEX. NEAR Intents has no testnet, so taint.near's swaps go here on testnet.
//! It keeps the deposit and logs an event; it does not swap anything. Every swap row in the benchmark is
//! labelled `mockdex`.

use near_sdk::{env, near, require, AccountId};

#[near(contract_state)]
#[derive(Default)]
pub struct MockDex {
    buys: u64,
}

#[near]
impl MockDex {
    #[payable]
    pub fn buy(&mut self, token: AccountId) {
        // It keeps whatever it is sent and has no withdraw, so it must never run where the money is real.
        require!(env::current_account_id().as_str().ends_with(".testnet"), "mockdex runs on testnet only");
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "attach a deposit");
        self.buys += 1;
        let event = near_sdk::serde_json::json!({
            "standard": "mockdex",
            "version": "1.0.0",
            "event": "buy",
            "data": { "token": token, "amount": amount.as_yoctonear().to_string(), "buyer": env::predecessor_account_id() },
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
    }

    pub fn get_buys(&self) -> u64 {
        self.buys
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn ctx(deposit_near: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("mockdex.taint.testnet".parse().unwrap())
            .predecessor_account_id("taint.near".parse().unwrap())
            .attached_deposit(NearToken::from_near(deposit_near))
            .build());
    }

    #[test]
    fn buy_logs_an_event_with_token_amount_and_buyer() {
        ctx(1);
        let mut dex = MockDex::default();
        dex.buy("newtoken.near".parse().unwrap());
        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].starts_with("EVENT_JSON:"), "{}", logs[0]);
        let event: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&logs[0]["EVENT_JSON:".len()..]).unwrap();
        assert_eq!(event["event"], "buy");
        assert_eq!(event["data"]["token"], "newtoken.near");
        assert_eq!(event["data"]["amount"], "1000000000000000000000000");
        assert_eq!(event["data"]["buyer"], "taint.near");
    }

    #[test]
    fn each_buy_is_counted() {
        ctx(1);
        let mut dex = MockDex::default();
        dex.buy("a.near".parse().unwrap());
        dex.buy("b.near".parse().unwrap());
        assert_eq!(dex.get_buys(), 2);
    }

    #[test]
    #[should_panic(expected = "testnet only")]
    fn buy_refuses_to_run_outside_testnet() {
        testing_env!(VMContextBuilder::new()
            .current_account_id("mockdex.near".parse().unwrap())
            .predecessor_account_id("taint.near".parse().unwrap())
            .attached_deposit(NearToken::from_near(1))
            .build());
        let mut dex = MockDex::default();
        dex.buy("a.near".parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "attach a deposit")]
    fn buy_without_a_deposit_is_refused() {
        testing_env!(VMContextBuilder::new()
            .current_account_id("mockdex.taint.testnet".parse().unwrap())
            .predecessor_account_id("taint.near".parse().unwrap())
            .build());
        let mut dex = MockDex::default();
        dex.buy("a.near".parse().unwrap());
    }
}

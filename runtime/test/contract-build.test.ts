import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// near-sdk only compiles its message-carrying panic path for wasm when built with `--cfg near` (cargo-near sets it).
// A plain `cargo build --target wasm32-unknown-unknown` without it turns every contract panic into a bare
// "WebAssembly trap: unreachable" on chain, hiding messages like "owner only" and "not pending".
// It was found by deploying to testnet. This keeps it from coming back.

describe("contract build configuration", () => {
  const file = path.join(__dirname, "../../contract/.cargo/config.toml");

  it("sets --cfg near for the wasm target", () => {
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toMatch(/\[target\.wasm32-unknown-unknown\]/);
    expect(text).toMatch(/rustflags\s*=\s*\[[^\]]*"--cfg"\s*,\s*"near"/);
  });

  it("does not set it for native builds, where the unit tests use the mock environment", () => {
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toMatch(/^\s*\[build\]/m);
    expect(text).not.toMatch(/^\s*rustflags\s*=.*\n(?!\s*\[)[\s\S]*\[target\.x86_64/m);
  });
});

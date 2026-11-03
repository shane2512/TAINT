import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, it } from "vitest";
import report from "./fixtures/near-ai-report.json";
import { Report, checkReport, checkSignature, ethAddress, expectedText, verifiedChat } from "../src/near-ai-verify";

const MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";
const rep = report as unknown as Report;
const nonce = rep.gateway_attestation.request_nonce;
const clone = (): Report => JSON.parse(JSON.stringify(rep));
const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "0" ? "1" : "0") + s.slice(i + 1);

/** An EIP-191 signature from a throwaway key, standing in for the model's signing key. */
function signer() {
  const priv = secp256k1.utils.randomPrivateKey();
  const address = ethAddress(secp256k1.getPublicKey(priv, false).slice(1));
  const sign = (text: string) => {
    const m = new TextEncoder().encode(text);
    const digest = keccak_256(new Uint8Array([...new TextEncoder().encode("\x19Ethereum Signed Message:\n" + m.length), ...m]));
    const s = secp256k1.sign(digest, priv);
    return "0x" + s.toCompactHex() + (s.recovery + 27).toString(16);
  };
  return { address, sign };
}

describe("attestation report (a real report recorded from NEAR AI Cloud, free endpoint)", () => {
  it("accepts the genuine report for its own nonce", () => {
    const r = checkReport(rep, nonce, MODEL);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("never claims the Intel quote chain was verified", () => {
    expect(checkReport(rep, nonce, MODEL).quoteChainVerified).toBe(false);
  });
  it("rejects a replayed report for a different nonce", () => {
    expect(checkReport(rep, "00".repeat(32), MODEL).ok).toBe(false);
  });
  it("rejects a swapped signing address (quote no longer vouches for it)", () => {
    const r = clone();
    r.model_attestations[0].signing_address = "0x" + "11".repeat(20);
    const out = checkReport(r, nonce, MODEL);
    expect(out.ok).toBe(false);
    expect(out.errors.join()).toMatch(/model/);
  });
  it("rejects a public key that does not hash to the address", () => {
    const r = clone();
    r.model_attestations[0].signing_public_key = "00".repeat(64);
    expect(checkReport(r, nonce, MODEL).errors.join()).toMatch(/signing_public_key/);
  });
  it("rejects a report for another model, or none", () => {
    expect(checkReport(rep, nonce, "other/model").ok).toBe(false);
  });
  it("catches a flipped bit in the quote's report data, but not elsewhere (only the Intel chain would)", () => {
    const q = rep.gateway_attestation.intel_quote;
    const elsewhere = clone();
    elsewhere.gateway_attestation.intel_quote = flip(q, 200);
    expect(checkReport(elsewhere, nonce, MODEL).ok).toBe(true);
    const inReportData = clone();
    inReportData.gateway_attestation.intel_quote = flip(q, 568 * 2 + 5);
    expect(checkReport(inReportData, nonce, MODEL).ok).toBe(false);
  });
});

describe("response signature", () => {
  const req = '{"model":"m","messages":[]}';
  const res = '{"id":"chatcmpl-1","choices":[]}';
  it("accepts a signature over our exact bytes by the verified signer", () => {
    const s = signer();
    const text = expectedText("m", req, res);
    expect(checkSignature({ text, signature: s.sign(text), signing_address: s.address, signing_algo: "ecdsa" }, s.address, "m", req, res).ok).toBe(true);
  });
  it("rejects if the response bytes changed by one character", () => {
    const s = signer();
    const text = expectedText("m", req, res);
    expect(checkSignature({ text, signature: s.sign(text), signing_address: s.address, signing_algo: "ecdsa" }, s.address, "m", req, res + " ").ok).toBe(false);
  });
  it("rejects a different signer, even with a self-consistent reply", () => {
    const real = signer();
    const other = signer();
    const text = expectedText("m", req, res);
    expect(checkSignature({ text, signature: other.sign(text), signing_address: other.address, signing_algo: "ecdsa" }, real.address, "m", req, res).ok).toBe(false);
  });
  it("rejects garbage signatures without throwing", () => {
    const s = signer();
    const text = expectedText("m", req, res);
    expect(checkSignature({ text, signature: "0x1234", signing_address: s.address, signing_algo: "ecdsa" }, s.address, "m", req, res).ok).toBe(false);
  });
});

describe("verifiedChat (stubbed network)", () => {
  const body = (b: string) => {
    const u = new TextEncoder().encode(b);
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  };
  it("flows report -> completion -> signature, hashing the bytes it actually sent", async () => {
    const s = signer();
    const r = clone();
    r.model_attestations[0].signing_address = s.address; // report names our stand-in signer, so its quote no longer matches
    const calls: string[] = [];
    let sent = "";
    const resBody = JSON.stringify({ id: "chatcmpl-9", choices: [{ message: { content: "hi" } }] });
    const fetchStub = async (url: string, init?: any) => {
      calls.push(url.replace(/\?.*/, ""));
      if (url.includes("/attestation/report")) return { ok: true, status: 200, arrayBuffer: async () => body(""), json: async () => r };
      if (url.includes("/chat/completions")) {
        sent = init.body;
        return { ok: true, status: 200, arrayBuffer: async () => body(resBody), json: async () => JSON.parse(resBody) };
      }
      const text = expectedText(MODEL, sent, resBody);
      return { ok: true, status: 200, arrayBuffer: async () => body(""), json: async () => ({ text, signature: s.sign(text), signing_address: s.address, signing_algo: "ecdsa" }) };
    };
    const out = await verifiedChat({ baseUrl: "https://x/v1", apiKey: "k", model: MODEL, messages: [], nonceHex: nonce, fetch: fetchStub as any });
    expect(calls).toEqual(["https://x/v1/attestation/report", "https://x/v1/chat/completions", "https://x/v1/signature/chatcmpl-9"]);
    expect(out.content).toBe("hi");
    expect(out.signature.ok).toBe(true);
    expect(out.preflight.ok).toBe(false); // the two checks are independent
  });
  it("reports an unavailable signature as unverified, not as success", async () => {
    const resBody = JSON.stringify({ id: "c1", choices: [{ message: { content: "x" } }] });
    const fetchStub = async (url: string) => {
      if (url.includes("/signature/")) return { ok: true, status: 200, arrayBuffer: async () => body(""), json: async () => ({ error_code: "unavailable", message: "later" }) };
      if (url.includes("/attestation/")) return { ok: true, status: 200, arrayBuffer: async () => body(""), json: async () => clone() };
      return { ok: true, status: 200, arrayBuffer: async () => body(resBody), json: async () => JSON.parse(resBody) };
    };
    const out = await verifiedChat({ baseUrl: "https://x/v1", apiKey: "k", model: MODEL, messages: [], nonceHex: nonce, fetch: fetchStub as any });
    expect(out.signature.ok).toBe(false);
  });
});

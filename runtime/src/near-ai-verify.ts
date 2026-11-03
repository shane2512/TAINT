import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/**
 * Checks on NEAR AI Cloud evidence (docs.near.ai, Verification). What this proves and what it does not:
 *  - the report echoes OUR nonce, and the TDX quote's report data is exactly signing address + nonce
 *    (so the signing key is the one the quote vouches for, and the quote is fresh);
 *  - a response signature is by that key, over `<model>:<sha256 request bytes>:<sha256 response bytes>`.
 *  - NOT checked here: the Intel signature chain of the quote itself (collateral, TCB status), the NVIDIA GPU
 *    evidence, and image measurements. Every result therefore carries `quoteChainVerified: false`.
 */

export interface TeeReport {
  signing_address: string;
  signing_algo: string;
  intel_quote: string;
  request_nonce: string;
  report_data?: string;
  signing_public_key?: string;
  model_name?: string;
}

export interface Report {
  gateway_attestation: TeeReport;
  model_attestations: TeeReport[];
}

export interface Checked {
  ok: boolean;
  errors: string[];
  /** Always false: see the note above. */
  quoteChainVerified: false;
}

// TDX quote v4: 48-byte header, then the TD report; report_data is the last 64 bytes of its 584-byte body.
const REPORT_DATA_AT = 48 + 520;

const strip0x = (s: string) => s.replace(/^0x/i, "").toLowerCase();

/** The 64 bytes a quote must carry for this signer and nonce: address, zero padding to 32 bytes, then the nonce. */
export function expectedReportData(address: string, nonceHex: string): string {
  return (strip0x(address) + "0".repeat(24) + strip0x(nonceHex)).toLowerCase();
}

export function ethAddress(uncompressedXY: Uint8Array): string {
  return "0x" + bytesToHex(keccak_256(uncompressedXY).slice(12));
}

function checkOne(r: TeeReport, nonce: string, label: string, errors: string[]): void {
  if (r.signing_algo !== "ecdsa") errors.push(`${label}: unsupported signing_algo ${r.signing_algo}`);
  if (strip0x(r.request_nonce ?? "") !== strip0x(nonce)) errors.push(`${label}: report does not echo our nonce`);
  let quote: Uint8Array;
  try {
    quote = hexToBytes(r.intel_quote);
  } catch {
    errors.push(`${label}: intel_quote is not hex`);
    return;
  }
  if (quote.length < REPORT_DATA_AT + 64) {
    errors.push(`${label}: intel_quote too short`);
    return;
  }
  const inQuote = bytesToHex(quote.slice(REPORT_DATA_AT, REPORT_DATA_AT + 64));
  if (inQuote !== expectedReportData(r.signing_address, nonce)) errors.push(`${label}: quote report data is not signing address + nonce`);
  if (r.report_data && strip0x(r.report_data) !== inQuote) errors.push(`${label}: report_data field disagrees with the quote`);
  if (r.signing_public_key) {
    const pub = hexToBytes(strip0x(r.signing_public_key));
    if (pub.length !== 64 || ethAddress(pub) !== "0x" + strip0x(r.signing_address)) {
      errors.push(`${label}: signing_public_key does not hash to signing_address`);
    }
  }
}

/** Preflight: the gateway report, and for `model` exactly one model report, both bound to `nonce`. */
export function checkReport(report: Report, nonce: string, model?: string): Checked {
  const errors: string[] = [];
  checkOne(report.gateway_attestation, nonce, "gateway", errors);
  if (model !== undefined) {
    const ms = (report.model_attestations ?? []).filter((m) => m.model_name === model);
    if (ms.length !== 1) errors.push(`expected exactly one model report for ${model}, got ${ms.length}`);
    else checkOne(ms[0], nonce, "model", errors);
  }
  return { ok: errors.length === 0, errors, quoteChainVerified: false };
}

export const sha256Hex = (b: Uint8Array | string) => bytesToHex(sha256(typeof b === "string" ? new TextEncoder().encode(b) : b));

/** The text a `provider_tee` signature covers. */
export function expectedText(model: string, requestBytes: Uint8Array | string, responseBytes: Uint8Array | string): string {
  return `${model}:${sha256Hex(requestBytes)}:${sha256Hex(responseBytes)}`;
}

/** EIP-191 personal_sign: the Ethereum address that signed `text`, from a 65-byte r||s||v signature. */
export function recoverSigner(text: string, signatureHex: string): string {
  const sig = hexToBytes(strip0x(signatureHex));
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  const msg = new TextEncoder().encode(text);
  const digest = keccak_256(new Uint8Array([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  if (v !== 0 && v !== 1) throw new Error("bad recovery id");
  const point = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest);
  return ethAddress(point.toRawBytes(false).slice(1));
}

export interface SignatureReply {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
}

/** The signature must be by the key a verified report vouched for, over exactly the bytes we sent and received. */
export function checkSignature(reply: SignatureReply, expectedSigner: string, model: string, requestBytes: Uint8Array | string, responseBytes: Uint8Array | string): Checked {
  const errors: string[] = [];
  if (reply.signing_algo !== "ecdsa") errors.push(`unsupported signing_algo ${reply.signing_algo}`);
  if (strip0x(reply.signing_address) !== strip0x(expectedSigner)) errors.push("signer is not the key from the verified report");
  if (reply.text !== expectedText(model, requestBytes, responseBytes)) errors.push("signed text does not match our request and response bytes");
  try {
    if (strip0x(recoverSigner(reply.text, reply.signature)) !== strip0x(expectedSigner)) errors.push("signature was not made by the verified signer");
  } catch (e) {
    errors.push(`signature unreadable: ${(e as Error).message}`);
  }
  return { ok: errors.length === 0, errors, quoteChainVerified: false };
}

export type Fetch = (url: string, init?: { headers?: Record<string, string>; method?: string; body?: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<any> }>;

export interface VerifiedChat {
  content: string;
  chatId: string;
  preflight: Checked;
  signature: Checked;
}

/**
 * Preflight report check, one completion with exact bytes kept, then the signature check. Needs credits for the
 * completion. Use a `provider_tee` model; a `gateway`-signed reply (streams, aliases) is reported as unverified.
 */
export async function verifiedChat(opts: { baseUrl: string; apiKey: string; model: string; messages: object[]; extra?: object; nonceHex: string; fetch?: Fetch }): Promise<VerifiedChat> {
  const f: Fetch = opts.fetch ?? (fetch as unknown as Fetch);
  const auth = { Authorization: `Bearer ${opts.apiKey}` };
  const rep = await f(`${opts.baseUrl}/attestation/report?model=${encodeURIComponent(opts.model)}&signing_algo=ecdsa&nonce=${opts.nonceHex}`, { headers: auth });
  if (!rep.ok) throw new Error(`attestation report: HTTP ${rep.status}`);
  const report: Report = await rep.json();
  const preflight = checkReport(report, opts.nonceHex, opts.model);
  const reqBody = JSON.stringify({ model: opts.model, messages: opts.messages, ...opts.extra });
  const res = await f(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "x-no-aliasing": "true", "Accept-Encoding": "identity" },
    body: reqBody,
  });
  const resBytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new Error(`completion: HTTP ${res.status} ${new TextDecoder().decode(resBytes).slice(0, 200)}`);
  const parsed = JSON.parse(new TextDecoder().decode(resBytes));
  const sigRes = await f(`${opts.baseUrl}/signature/${encodeURIComponent(parsed.id)}?signing_algo=ecdsa`, { headers: auth });
  const reply = sigRes.ok ? await sigRes.json() : undefined;
  const signer = report.model_attestations.find((m) => m.model_name === opts.model)?.signing_address ?? "";
  const signature: Checked =
    !reply || reply.error_code || !reply.signature
      ? { ok: false, errors: ["no signature available: reply is unverified"], quoteChainVerified: false }
      : checkSignature(reply, signer, opts.model, reqBody, resBytes);
  return { content: parsed.choices?.[0]?.message?.content ?? "", chatId: parsed.id, preflight, signature };
}

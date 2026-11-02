// A stand-in NEAR RPC node, so the browser tests exercise the real read-only client and the redirect-return path
// without touching testnet. It answers get_pending, get_book and the status of three canned transactions.
import http from "node:http";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const outside = { class: "Untrusted", source: "email:billing@acrne.testnet" };
const rows = {
  get_pending: [[7, { hash: "hash7", action: { kind: "Transfer", recipient: "acrne.testnet", token: null, amount: "400000000000000000000000" }, prov: { recipient: outside, token: null, amount: outside }, flow_hash: "f7", created_at: String(Date.now()) + "000000" }]],
  get_book: [["acme.testnet", { cap: "1000000000000000000000000", expires_at: String(Date.now() + 1e9) + "000000", learned_from: "owner" }]],
};
const outcome = (hash, value) => ({ status: { SuccessValue: "" }, transaction: { hash }, receipts_outcome: [{ outcome: { status: { SuccessValue: value ? b64(value) : "" } } }] });
const txs = {
  TXOK: outcome("TXOK", { Executed: { proposal_id: 7 } }),
  TXREJ: outcome("TXREJ", { Rejected: { reason: "global cap exceeded" } }),
  TXFAIL: { status: { Failure: { ActionError: { kind: "FunctionCallError" } } }, transaction: { hash: "TXFAIL" }, receipts_outcome: [] },
};

http
  .createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "content-type": "application/json" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    if (req.method === "GET") return res.writeHead(200, cors).end('{"ok":true}');
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(raw || "{}");
      let result;
      if (method === "query" && params?.request_type === "call_function") {
        result = { result: Array.from(Buffer.from(JSON.stringify(rows[params.method_name] ?? []))), logs: [], block_height: 1, block_hash: "11111111111111111111111111111111" };
      } else if (method === "tx") {
        result = txs[Array.isArray(params) ? params[0] : params?.tx_hash] ?? txs.TXFAIL;
      }
      res.writeHead(200, cors).end(JSON.stringify(result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code: -32601, message: "stub: unknown " + method } }));
    });
  })
  .listen(3300, "127.0.0.1");

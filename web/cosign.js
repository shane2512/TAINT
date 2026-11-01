// Everything that comes from the server (and so from an attacker) is inserted with textContent, never innerHTML.
const $ = (id) => document.getElementById(id);

function row(label, value, cls) {
  const p = document.createElement("p");
  const b = document.createElement("strong");
  b.textContent = label + ": ";
  const s = document.createElement("span");
  s.textContent = value;
  if (cls) s.className = cls;
  p.append(b, s);
  return p;
}

async function approve(item, remember, status) {
  const res = await fetch("/cosign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalId: item.proposalId, proposalHash: item.proposalHash, remember }),
  });
  const out = await res.json();
  status.textContent = res.ok ? "Approved" + (out.explorer ? " on chain: " + out.explorer : ": " + JSON.stringify(out)) : "Refused: " + (out.error ?? res.status);
  if (res.ok) for (const b of status.parentElement.querySelectorAll("button")) b.disabled = true; // keep the transaction link on screen
}

function card(item) {
  const el = document.createElement("article");
  el.className = "pending";
  const a = item.action;
  el.append(
    row("Action", a.kind === "Transfer" ? `send ${item.amountNear} NEAR to ${a.recipient}` : `swap ${item.amountNear} NEAR into ${a.token}`),
    row("Where the value came from", item.sourceLine || "(your own instruction)", "source"),
    row("Amount", item.amountUsd === null ? `${item.amountNear} NEAR (no price feed configured)` : `${item.amountNear} NEAR`),
    row("Account created", item.accountCreated === "unknown" ? "unknown (no indexer configured)" : item.accountCreated),
  );
  if (item.diff) el.append(row("Lookalike check", item.diff, "warn"));
  const status = document.createElement("p");
  status.className = "note";
  const once = document.createElement("button");
  once.type = "button";
  once.textContent = "Approve once";
  once.addEventListener("click", () => approve(item, false, status));
  const remember = document.createElement("button");
  remember.type = "button";
  remember.className = "secondary";
  remember.textContent = "Approve & remember (cap 1 NEAR, 30 days)";
  remember.addEventListener("click", () => approve(item, true, status));
  el.append(once, remember, status);
  return el;
}

async function load() {
  const items = await (await fetch("/pending")).json();
  $("pending").textContent = "";
  $("empty").hidden = items.length > 0;
  for (const it of items) $("pending").appendChild(card(it));
}

const meta = await (await fetch("/meta")).json();
$("banner").textContent = meta.banner;
$("mode-note").textContent = meta.banner.includes("mode=MOCK")
  ? "MOCK: approval is recorded directly. LIVE uses a NEP-366 delegate action signed in your wallet and submitted by a relayer."
  : "Real chain: Approve signs one NEP-366 delegate action with the demo owner key held by this server (not your wallet); a relayer submits it and pays the gas.";
await load();

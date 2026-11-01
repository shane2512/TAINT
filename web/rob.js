// Everything that comes from the server (and so from an attacker) is inserted with textContent, never innerHTML.
const $ = (id) => document.getElementById(id);

const SPRITE = { drained: "\u{1F635}", blocked: "\u{1F6E1}️", pending: "\u{1F512}", ok: "\u{1F63A}", executed: "\u{1F635}", none: "\u{1F610}" };
const STATE = {
  drained: "DRAINED: funds moved",
  blocked: "blocked",
  pending: "held for your co-sign",
  ok: "done: legitimate task completed",
  executed: "executed",
  none: "no action",
};

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json() };
}

function showResult(agent, r) {
  const card = $("pet-" + agent);
  card.className = "pet " + r.label;
  card.querySelector(".sprite").textContent = SPRITE[r.label] ?? SPRITE.none;
  card.querySelector(".state").textContent = STATE[r.label] ?? r.label;
  const parts = [];
  if (r.reasons?.length) parts.push(r.reasons.join("; "));
  if (r.path) parts.push("source: " + r.path);
  card.querySelector(".detail").textContent = parts.join("  |  ");
}

function addLogRow(entry) {
  const tr = document.createElement("tr");
  const cells = [
    entry.preset ?? entry.text ?? "",
    entry.naive.outcome,
    entry.allowlist.outcome,
    entry.taint.outcome,
    entry.taint.path || (entry.taint.reasons ?? []).join("; "),
  ];
  for (const c of cells) {
    const td = document.createElement("td");
    td.textContent = c;
    tr.appendChild(td);
  }
  $("log").tBodies[0].prepend(tr);
}

async function send(body) {
  const { status, body: out } = await getJson("/attack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (status !== 200) {
    $("verdict").textContent = out.error ?? "request failed";
    return;
  }
  const [naive, allowlist, taint] = out.results;
  showResult("naive", naive);
  showResult("allowlist", allowlist);
  showResult("taint", taint);
  $("verdict").textContent = `Naive: ${naive.label}. Allowlist+Caps: ${allowlist.label}. TAINT: ${taint.label}.`;
  const log = await (await fetch("/log")).json();
  $("log").tBodies[0].textContent = "";
  for (const e of log) addLogRow(e);
}

const meta = await (await fetch("/meta")).json();
$("banner").textContent = meta.banner;
const mock = meta.banner.includes("mode=MOCK");
$("free-note").textContent = mock
  ? "MOCK: only the presets above have recorded model outputs, so free text needs a live model."
  : "";

for (const p of meta.presets) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = p.kind;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = p.kind; // the word, not only a color, says whether this is an attack or a legitimate task
  b.append(tag, document.createTextNode(`${p.id}: ${p.title}`));
  b.addEventListener("click", () => send({ preset: p.id }));
  $("presets").appendChild(b);
}

$("free").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (text) send({ text });
});

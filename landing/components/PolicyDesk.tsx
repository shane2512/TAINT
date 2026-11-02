"use client";
import { useEffect, useState } from "react";
import { Halftone } from "./Halftone";
import { api, Outcome } from "./ui";

const TABS = ["ACTION", "SOURCES", "WALLET", "RULES"];
const RULES = [
  "A value in the owner's signed instruction is owner-class. Everything else is untrusted.",
  "Owner-class payments run inside the 5 NEAR rolling 24h cap.",
  "An untrusted recipient is held, unless it is remembered or registered by a pinned account.",
  "An untrusted amount is held unless a covered recipient's cap allows it.",
  "An untrusted swap token is always held.",
  "Held proposals expire after 15 minutes.",
];

function Seg({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <fieldset className="field">
      <legend className="gl">{label}</legend>
      <div className="g2">{options.map((o) => <button type="button" key={o} className={value === o ? "on" : ""} aria-pressed={value === o} onClick={() => onChange(o)}>{o}</button>)}</div>
    </fieldset>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return <div className="row"><span>{label}</span><button type="button" className="tg" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>{on ? "ON" : "OFF"}</button></div>;
}

interface Verdict { decision: string; reasons: string[] }

export default function PolicyDesk({ caseCount }: { caseCount: number }) {
  const [tab, setTab] = useState("ACTION");
  const [kind, setKind] = useState("TRANSFER");
  const [target, setTarget] = useState("attacker.testnet");
  const [amount, setAmount] = useState(1.5);
  const [recipientFrom, setRecipientFrom] = useState("OUTSIDE");
  const [amountFrom, setAmountFrom] = useState("OUTSIDE");
  const [label, setLabel] = useState("x.com/@attacker");
  const [remembered, setRemembered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [spent, setSpent] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // "owner" is the rules' own word for the owner; an outside source that is merely named that must not become one.
    const outside = label.trim().toLowerCase() === "owner" ? "outside (named owner)" : label;
    const from = (v: string) => (v === "OWNER" ? "owner" : outside);
    const swap = kind === "SWAP";
    const t = setTimeout(async () => {
      try {
        const r = await api<Verdict>("policy/evaluate", {
          kind: swap ? "Swap" : "Transfer",
          [swap ? "token" : "recipient"]: target,
          amountNear: amount.toFixed(1),
          [swap ? "tokenSource" : "recipientSource"]: from(recipientFrom),
          amountSource: from(amountFrom),
          remembered, pinnedPayee: pinned,
          spentNear: spent ? spent.toFixed(1) : undefined,
        });
        if (!live) return;
        if (r.ok) { setVerdict(r.body); setErr(null); } else setErr(r.body.error ?? "Could not evaluate that.");
      } catch {
        if (live) setErr("The runtime did not answer.");
      }
    }, 160);
    return () => { live = false; clearTimeout(t); };
  }, [kind, target, amount, recipientFrom, amountFrom, label, remembered, pinned, spent]);


  return (
    <div className="desk" data-testid="policy-desk" data-fade>
      <div className="deskbar">
        <span>PROPOSAL</span><span>{kind === "SWAP" ? "SWAP" : "TRANSFER"} {amount.toFixed(1)} NEAR</span><i className="sp" />
        <span className="live"><i /> REAL RULES</span>
      </div>
      <div className="deskbody">
        <div className="deskview">
          <Halftone scene="waves" cell={9} seed={7} className="cv" wave={0.18} />
          <div className="verdict" aria-live="polite" data-testid="verdict">
            {err ? <p className="verdict-err">{err}</p> : verdict && (
              <>
                <Outcome value={verdict.decision} />
                <ul>{verdict.reasons.length ? verdict.reasons.map((r) => <li key={r}>{r}</li>) : <li>Inside every cap. No co-sign needed.</li>}</ul>
              </>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="tabs" role="tablist">{TABS.map((t, i) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
          {tab === "ACTION" && (
            <div className="pbody">
              <Seg label="KIND" value={kind} options={["TRANSFER", "SWAP"]} onChange={setKind} />
              <label className="field"><span className="gl">{kind === "SWAP" ? "TOKEN" : "RECIPIENT"}</span><input className="txt" value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} /></label>
              <div className="row"><label htmlFor="amt">AMOUNT</label><input id="amt" type="range" min={0.1} max={6} step={0.1} value={amount} onChange={(e) => setAmount(+e.target.value)} /><small>{amount.toFixed(1)} NEAR</small></div>
            </div>
          )}
          {tab === "SOURCES" && (
            <div className="pbody">
              <Seg label={kind === "SWAP" ? "TOKEN CAME FROM" : "RECIPIENT CAME FROM"} value={recipientFrom} options={["OWNER", "OUTSIDE"]} onChange={setRecipientFrom} />
              <Seg label="AMOUNT CAME FROM" value={amountFrom} options={["OWNER", "OUTSIDE"]} onChange={setAmountFrom} />
              <label className="field"><span className="gl">OUTSIDE SOURCE</span><input className="txt" value={label} maxLength={128} onChange={(e) => setLabel(e.target.value)} spellCheck={false} /></label>
            </div>
          )}
          {tab === "WALLET" && (
            <div className="pbody">
              <Toggle label="REMEMBERED (CAP 1 NEAR)" on={remembered} onChange={setRemembered} />
              <Toggle label="PAYEE OF A PINNED ACCOUNT (CAP 0.5)" on={pinned} onChange={setPinned} />
              <div className="row"><label htmlFor="spent">SPENT TODAY</label><input id="spent" type="range" min={0} max={5} step={0.5} value={spent} onChange={(e) => setSpent(+e.target.value)} /><small>{spent.toFixed(1)} / 5</small></div>
            </div>
          )}
          {tab === "RULES" && <ol className="pbody rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ol>}
        </div>
      </div>
      <div className="deskfoot"><span>RUNS THE MOCK CONTRACT</span><span>{caseCount} SHARED CASES</span><span>TS / RUST / JSON</span><span>NOTHING HERE MOVES FUNDS</span></div>
    </div>
  );
}

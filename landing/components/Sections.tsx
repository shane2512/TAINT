"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { GlyphCanvas, FlowCanvas } from "./Canvases";
import PolicyDesk from "./PolicyDesk";
import { RAMPS, type Clock } from "./ascii";
import { go } from "./Shell";
import { Icon, OUTCOME } from "./ui";
import type { FixtureView, LiveRedteam, LiveReplay } from "../lib/data";

const clock = (): Clock => ({ t: 0, paused: false });

export function Glitch({ word }: { word: string }) {
  return (
    <span className="glitch" aria-label={word}>
      {word.split("").map((c, i) => <i key={i} aria-hidden>{c}</i>)}
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow" data-fade>{children}</p>;
}

/* 01 INTRO */
export function Intro({ caseCount }: { caseCount: number }) {
  const c = useRef(clock()).current;
  return (
    <section id="intro" className="intro">
      <div className="hero-meta"><span>PROVENANCE-GATED WALLET / MIT LICENSED</span><span>NEAR TESTNET / RUST + TYPESCRIPT</span></div>
      <GlyphCanvas clock={c} follow className="hero-canvas" opts={{ cell: 14, ramp: RAMPS.classic, base: 0.5 }} />
      <h1 className="hero-title">
        <span className="line"><span>CHECK WHO</span></span>
        <span className="line"><span>{" "}</span><Glitch word="DECIDED" /></span>
      </h1>
      <div className="hero-rule" data-line />
      <div className="hero-cta">
        <p className="hero-sub">Allowlists check where money goes. TAINT checks who decided. Values an AI agent read in outside text wait for your co-sign.</p>
        <Link className="btn primary" href="/demo">TRY TO ROB IT <Icon name="ne" /></Link>
        <a className="btn ghost" href="#benchmark" onClick={(e) => { e.preventDefault(); go("benchmark"); }}>READ THE BENCHMARK <Icon name="down" /></a>
        <p className="fine">TESTNET ONLY | NO MAINNET FUNDS | TEE STUBBED | {caseCount} SHARED POLICY CASES</p>
      </div>
    </section>
  );
}

function Marked({ text, flagged, on }: { text: string; flagged: string[]; on: boolean }) {
  if (!on || !flagged.length) return <>{text}</>;
  const esc = flagged.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return <>{text.split(new RegExp(`(${esc})`, "g")).map((p, i) => (flagged.includes(p) ? <mark key={i}>{p}</mark> : p))}</>;
}

function Reading({ f, flagged }: { f: FixtureView; flagged: boolean }) {
  return (
    <div className="reading">
      <p className="rlabel">OWNER SIGNED</p>
      <p className="rtext owner">{f.instruction}</p>
      {f.attachments.length ? f.attachments.map((a) => (
        <div key={a.source}>
          <p className="rlabel">OUTSIDE TEXT {flagged && <b>UNTRUSTED</b>} / {a.source}</p>
          <p className="rtext"><Marked text={a.text} flagged={f.flagged} on={flagged} /></p>
        </div>
      )) : <p className="rlabel">NO OUTSIDE TEXT</p>}
      {flagged && f.attachments.length > 0 && f.flagged.length > 0 && (
        <ul className="handles">{f.flagged.map((v, i) => <li key={v}><span>$h{i + 1}</span><b>{v}</b><span>{"<-"} {f.attachments[0].source}</span></li>)}</ul>
      )}
    </div>
  );
}

/* 02 PROVENANCE */
export function Demo({ fixtures }: { fixtures: FixtureView[] }) {
  const c = useRef(clock()).current;
  const [id, setId] = useState(fixtures[0].id);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(30);
  const box = useRef<HTMLDivElement>(null);
  c.paused = paused;
  const f = fixtures.find((x) => x.id === id)!;
  const drag = (e: React.PointerEvent) => {
    const el = box.current!;
    const move = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); setPos(Math.min(95, Math.max(5, ((ev.clientX - r.left) / r.width) * 100))); };
    move(e.nativeEvent);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const v = OUTCOME[f.taint] ?? OUTCOME.none;
  return (
    <section id="demo" className="sec">
      <Eyebrow>THE SAME TEXT / TWO WAYS TO READ IT</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>SEE WHO WROTE IT.</span></h2><span className="live"><i /> REAL FIXTURES</span></div>
      <div className="frame" data-fade>
        <div className="compare" ref={box} onPointerDown={drag} data-testid="compare">
          <FlowCanvas clock={c} className="cv" />
          <Reading f={f} flagged={false} />
          <div className="over" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} data-testid="taint-view">
            <div className="solid" />
            <GlyphCanvas clock={c} className="cv" opts={{ cell: 8, ramp: RAMPS.classic }} />
            <Reading f={f} flagged />
          </div>
          <span className="tag l">THE MODEL READS =(</span>
          <span className="tag r">TAINT READS =)</span>
          <button className="handle" style={{ left: `${pos}%` }} aria-label="Drag to compare"><Icon name="lr" size={16} /></button>
          <i className="divider" style={{ left: `${pos}%` }} />
        </div>
        <div className="ctrl">
          <span className="cl">SCENARIO</span>
          <div className="seg">{fixtures.map((x) => <button key={x.id} className={id === x.id ? "on" : ""} aria-pressed={id === x.id} onClick={() => setId(x.id)}>{x.id}</button>)}</div>
          <div className="cyc"><span className="cl">TAINT</span><b data-testid="scenario-outcome">{v.word}</b></div>
          <button className="cyc" onClick={() => setPaused(!paused)}><span className="cl">MOTION</span><b>{paused ? "PLAY" : "PAUSE"}</b></button>
          <Link className="cyc" href="/demo"><span className="cl">RUN IT</span><b><Icon name="ne" /></b></Link>
        </div>
      </div>
      <p className="note" data-fade>{f.title}. Text and values from bench/fixtures/{f.id}.json. The field behind is decoration.</p>
    </section>
  );
}

/* 03 WORKFLOW */
const STEPS = [
  { n: "01", t: "PROPOSE", d: "A quarantined extractor reads outside text and returns typed values. The planner sees only opaque handles. The worker key proposes a payment with every argument tagged Owner or Untrusted." },
  { n: "02", t: "HOLD", d: "The contract runs owner-class payments inside the daily cap. An untrusted value waits as a pending proposal for 15 minutes, showing where it came from." },
  { n: "03", t: "CO-SIGN", d: "The owner signs one delegate action. A relayer submits it and pays the gas. The signed delegate cannot be replayed." },
];
export function Workflow() {
  return (
    <section id="workflow" className="sec">
      <Eyebrow>OUTSIDE TEXT / TO A HELD PAYMENT / TO YOUR CALL</Eyebrow>
      <h2><span data-scramble>FROM PROMPT TO PAYMENT.</span></h2>
      <div className="cards" data-stagger>
        {STEPS.map((s, i) => (
          <article className={`card c${i}`} key={s.n}>
            <span className="idx">{s.n}</span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* 04 FEATURES */
const FEATURES = [
  { k: "A", t: "PROVENANCE GATING", m: "PER ARGUMENT", d: "Each argument of a payment is Owner or Untrusted. A value is Owner only if it appears as a whole token in the signed instruction." },
  { k: "B", t: "QUARANTINED EXTRACTOR", m: "TYPED HANDLES", d: "The model that reads outside text has no wallet tools, and the planner never sees that text. It works with opaque handles." },
  { k: "C", t: "PINNED ACCOUNTS", m: "0.5 NEAR COOLDOWN", d: "An address registered by an account you pinned is covered, at 0.5 NEAR for its first 24 hours. A Unicode lookalike fails the parser." },
  { k: "D", t: "24 HOUR CAP", m: "5 NEAR ROLLING", d: "A leaked worker key can send at most the cap a day. On the Rust contract the owner can pause it, remove the worker, or withdraw." },
  { k: "E", t: "OWNER CO-SIGN", m: "ONCE OR REMEMBER", d: "Approve once and leave no trace, or remember the recipient with a 1 NEAR cap for 30 days. Remembering never lowers an entry you set." },
  { k: "F", t: "NEP-366 RELAY", m: "NO OWNER GAS", d: "The owner signs off chain. The relayer forwards one cosign call to the TAINT contract, with zero deposit, and nothing else." },
  { k: "G", t: "REPLAY GUARD", m: "FLOW HASH", d: "The flow hash comes from the owner's nonce alone, so a model that re-plans the same message cannot trigger a second payment." },
  { k: "H", t: "SHARED POLICY CASES", m: "TS = RUST", d: "One JSON rule table runs against both the TypeScript mock and the Rust contract. Both have to agree on every case." },
];
export function Features() {
  const [i, setI] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    gsap.fromTo(panel.current!.querySelectorAll("[data-sw]"), { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: "power4.out", stagger: 0.07 });
  }, [i]);
  const f = FEATURES[i];
  return (
    <section id="features" className="sec">
      <Eyebrow>WHAT THE WALLET ENFORCES / EIGHT PARTS</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>THE WHOLE ROUND.</span></h2>
        <p className="aside" data-fade>One agent. Two classes of value. A rule table that the mock and the contract both have to pass.</p></div>
      <div className="split" data-fade>
        <ul className="grid8">
          {FEATURES.map((x, j) => (
            <li key={x.k}><button className={j === i ? "on" : ""} onMouseEnter={() => setI(j)} onFocus={() => setI(j)} onClick={() => setI(j)}>
              <span className="k">[{x.k}]</span><span className="t">{x.t}</span><span className="m">{x.m}</span></button></li>
          ))}
        </ul>
        <div className="detail" ref={panel} aria-live="polite">
          <span className="k" data-sw>[{f.k}]</span><span className="m" data-sw>{f.m}</span>
          <h3 data-sw>{f.t}</h3>
          <p data-sw>{f.d}</p>
        </div>
      </div>
    </section>
  );
}

/* 05 POLICY DESK */
export function Interface({ caseCount }: { caseCount: number }) {
  return (
    <section id="interface" className="sec">
      <Eyebrow>POLICY DESK / HAVE A GO</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>YOU&apos;RE IN CHARGE NOW.</span></h2>
        <p className="aside" data-fade>Build a proposal and say where each value came from. The real rules answer. Nothing here moves funds.</p></div>
      <PolicyDesk caseCount={caseCount} />
    </section>
  );
}

/* 06 LIMITS (light) */
const FACTS: [string, string][] = [["APPROVAL", "OWNER CO-SIGN"], ["WORKER CAP", "5 NEAR / 24H"], ["NETWORK", "TESTNET ONLY"], ["TEE ATTESTATION", "STUBBED"], ["CONTRACT KEY", "STILL HELD"]];
export function Privacy() {
  return (
    <section id="privacy" className="light">
      <div className="pv">
        <div className="pv-num"><span>00</span><small>MAINNET FUNDS AT RISK. IT HAS NEVER RUN THERE.</small></div>
        <div className="pv-main">
          <i className="blob" aria-hidden />
          <div className="pv-copy">
            <p className="eyebrow">WHAT THE MODEL READS / STAYS UNTRUSTED</p>
            <h2><span data-scramble>YOUR MONEY NEVER BECOMES THEIR DECISION.</span></h2>
            <p>Outside text can suggest a payment. It cannot approve one. Its values stay untrusted, so the contract holds them until you co-sign. All of this runs on testnet. The attestation is a stub and the contract account still holds its full-access key.</p>
            <p className="links"><a href="#faq" onClick={(e) => { e.preventDefault(); go("faq"); }}>READ THE FAQ <Icon name="ne" size={10} /></a> <Link href="/results">INSPECT THE NUMBERS <Icon name="ne" size={10} /></Link></p>
          </div>
        </div>
        <ul className="pv-facts" data-stagger>{FACTS.map(([a, b]) => <li key={a}><small>{a}</small><b>{b}</b></li>)}</ul>
      </div>
    </section>
  );
}

/* 07 BENCHMARK */
function tally(replay: LiveReplay, agent: string, kind: "F" | "L") {
  const out: Record<string, number> = {};
  let total = 0;
  for (const [fx, row] of Object.entries(replay.matrix)) {
    if (!fx.startsWith(kind)) continue;
    for (const [k, n] of Object.entries(row[agent] ?? {})) { out[k] = (out[k] ?? 0) + n; total += n; }
  }
  return { out, total };
}
export function Benchmark({ replay, redteams }: { replay: LiveReplay; redteams: LiveRedteam[] }) {
  const [h, setH] = useState<number | null>(null);
  const naive = tally(replay, "naive", "F");
  const allow = tally(replay, "allowlist", "F");
  const allowL = tally(replay, "allowlist", "L");
  const taint = tally(replay, "taint", "F");
  const taintL = tally(replay, "taint", "L");
  const attempts = redteams.reduce((a, r) => a + r.attempts, 0);
  const errors = redteams.reduce((a, r) => a + r.errors, 0);
  const failures = redteams.reduce((a, r) => a + r.failures, 0);
  const rows = [
    { n: "01", t: "Naive", m: "Attack fixtures, live model", r: `DRAINED ${naive.out.drained ?? 0}/${naive.total}`, href: "/results" },
    { n: "02", t: "Allowlist+Caps", m: `Also blocked the legitimate runs: ${allowL.out.blocked ?? 0}/${allowL.total}`, r: `BLOCKED ${allow.out.blocked ?? 0}/${allow.total}`, href: "/results" },
    { n: "03", t: "TAINT", m: `Legitimate runs done ${taintL.out.ok ?? 0}/${taintL.total}. ${taint.out["no-action"] ?? 0} attack runs did nothing`, r: `HELD ${taint.out.pending ?? 0}/${taint.total}`, href: "/results" },
    { n: "04", t: "Red team", m: `${attempts} live attempts, ${redteams.length} models, ${errors} API error rows`, r: `${failures} FAILURES`, href: "/redteam" },
    { n: "05", t: "Contract", m: "Rust, on testnet, co-signed through NEP-366", r: "ON TESTNET", href: "/cosign" },
  ];
  return (
    <section id="benchmark" className="sec">
      <Eyebrow>LIVE REPLAY / THREE WALLETS, ONE MODEL</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>SAME MODEL.</span><br /><span data-scramble>DIFFERENT HANDS.</span></h2>
        <p className="aside" data-fade>The model was real and the payments were simulated. The allowlist stopped the attacks and the useful payments alike. TAINT stopped the attacks and finished the useful ones.</p></div>
      <ul className="rows" data-stagger onMouseLeave={() => setH(null)} data-testid="bench-rows">
        {rows.map((b, i) => (
          <li key={b.n} className={(h === null ? i === 2 : h === i) ? "on" : ""} onMouseEnter={() => setH(i)}>
            <Link href={b.href}>
              <span className="n">{b.n}</span><span className="name">{b.t}</span><span className="meta">{b.m}</span><span className="res">{b.r} <Icon name="ne" size={10} /></span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="note">Model {replay.model}, {replay.total} agent runs, {replay.errors} error rows. One model, one provider, four fixtures the authors chose.</p>
    </section>
  );
}

/* 08 INSIDE THE APP */
const ECO = [
  { c: "ROB", u: "/demo", d: "Fire real attacks at three wallets and watch which one pays." },
  { c: "APPROVE", u: "/cosign", d: "See where a held value came from, then approve or leave it." },
  { c: "MANAGE", u: "/wallet", d: "The address book, pinned accounts and the 24 hour cap." },
  { c: "TEST", u: "/policy", d: "Build any proposal and run the shared rule table." },
  { c: "ATTACK", u: "/redteam", d: "Twelve attacks against a fully fooled model." },
  { c: "AUDIT", u: "/results", d: "Every saved run, every miss, every unfinished item." },
];
export function Ecosystem() {
  const [h, setH] = useState(0);
  return (
    <section id="ecosystem" className="sec">
      <Eyebrow>INSIDE THE APP / SIX WAYS IN</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>DON&apos;T GO HOME YET.</span></h2>
        <p className="aside" data-fade>Everything above runs. Pick a page and try to break it.</p></div>
      <ul className="eco" data-stagger>
        {ECO.map((e, i) => (
          <li key={e.u} className={h === i ? "on" : ""} onMouseEnter={() => setH(i)}>
            <Link href={e.u}><span className="c">{e.c}</span><span className="u">{e.u}</span><span className="d">{e.d}</span><span className="ar"><Icon name="ne" /></span></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 09 FAQ */
const FAQ = [
  { q: "WHAT DOES TAINT STOP?", a: "A model fooled by text it read, such as an email, a post or a token listing, paying an account you never chose. Values from that text stay untrusted and wait for your co-sign." },
  { q: "WHY NOT JUST AN ALLOWLIST?", a: "An allowlist checks where money goes, so it cannot tell who chose an allowed account. In the live replay it also blocked every legitimate payment." },
  { q: "WHERE DO MY KEYS GO?", a: "The worker key only proposes, and its spending is capped. The owner key signs co-sign delegates. For now the co-sign page uses a demo owner key on the local server, not a wallet." },
  { q: "WHAT IS NOT DONE YET?", a: "Mainnet, wallet signing in the browser, real TEE attestation, and deleting the contract's full-access key. Until that key is gone, its holder can bypass the policy." },
  { q: "WHAT DOES THE BENCHMARK PROVE?", a: "That with one live model and four fixtures, TAINT held or did nothing on attacks and finished the legitimate payments. It does not prove safety against every attack." },
  { q: "IS IT REALLY OPEN?", a: "The license is MIT. The runtime, the contract and every result file are in one repository, which goes public for submission." },
];
export function Faq() {
  const [i, setI] = useState(0);
  const p = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    gsap.fromTo(p.current!.querySelectorAll("[data-sw]"), { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: "power4.out", stagger: 0.07 });
  }, [i]);
  return (
    <section id="faq" className="sec">
      <Eyebrow>STRAIGHT ANSWERS / INCLUDING THE AWKWARD ONES</Eyebrow>
      <h2><span data-scramble>THE USUAL, PLEASE.</span></h2>
      <div className="split faq" data-fade>
        <ul className="qs">{FAQ.map((f, j) => <li key={f.q}><button className={j === i ? "on" : ""} aria-expanded={j === i} onClick={() => setI(j)}><small>{String(j + 1).padStart(2, "0")}</small>{f.q}</button></li>)}</ul>
        <div className="detail" ref={p} aria-live="polite">
          <small data-sw>{String(i + 1).padStart(2, "0")}</small><small className="r" data-sw>ANSWER</small>
          <h3 data-sw>{FAQ[i].q}</h3>
          <p data-sw>{FAQ[i].a}</p>
        </div>
      </div>
    </section>
  );
}

export const FOOT_LINKS = [
  { h: "TRY IT", l: [["Rob the Pet", "/demo"], ["Co-sign", "/cosign"], ["Wallet", "/wallet"]] },
  { h: "CHECK IT", l: [["Policy", "/policy"], ["Red team", "/redteam"], ["Results", "/results"]] },
];

export function Foot() {
  return (
    <footer className="foot">
      <div><b><Icon name="logo" /> TAINT</b><p>(c) 2026 TAINT, MIT LICENSE</p></div>
      {FOOT_LINKS.map((g) => <div key={g.h}><u>{g.h}</u>{g.l.map(([t, h]) => <p key={h}><Link href={h}>{t}</Link></p>)}</div>)}
      <div><u>NETWORK</u><p><a href="https://testnet.nearblocks.io/address/taint-myname.testnet" target="_blank" rel="noreferrer">taint-myname.testnet <Icon name="ne" size={10} /></a></p><p>NEAR testnet only</p></div>
      <div className="fine"><p>ATTESTATION STUBBED</p><p>BUILT WITH NEXT.JS, GSAP AND LENIS</p></div>
    </footer>
  );
}

/* 10 START + footer (light) */
export function Install() {
  const c = useRef(clock()).current;
  return (
    <section id="install" className="light end">
      <GlyphCanvas clock={c} follow className="end-canvas" opts={{ cell: 14, ramp: RAMPS.classic, light: true, base: 1.1 }} />
      <div className="end-in">
        <p className="eyebrow">THREE WALLETS / ONE ATTACK / YOUR PICK</p>
        <h2><span data-scramble>MAKE EACH SPEND</span><br /><Glitch word="ACCOUNTABLE" /></h2>
        <Link className="btn outline" href="/demo">TRY TO ROB IT <Icon name="ne" /></Link>
      </div>
      <Foot />
    </section>
  );
}

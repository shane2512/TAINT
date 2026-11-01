"use client";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { GlyphCanvas, FlowCanvas } from "./Canvases";
import { RAMPS, type Clock } from "./ascii";
import { go } from "./Shell";

const clock = (): Clock => ({ t: 0, paused: false });

function Glitch({ word }: { word: string }) {
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
export function Intro() {
  const c = useRef(clock()).current;
  return (
    <section id="intro" className="intro">
      <div className="hero-meta"><span>PROVENANCE-GATED WALLET / FREE + OPEN SOURCE</span><span>NEAR TESTNET / RUST + TYPESCRIPT</span></div>
      <GlyphCanvas clock={c} follow className="hero-canvas" opts={{ cell: 14, ramp: RAMPS.classic, base: 0.5 }} />
      <h1 className="hero-title">
        <span className="line"><span>CHECK WHO</span></span>
        <span className="line"><span>{" "}</span><Glitch word="DECIDED" /></span>
      </h1>
      <div className="hero-rule" data-line />
      <div className="hero-cta">
        <p className="hero-sub">Allowlists check where money goes. TAINT checks who decided. Quarantine the model, gate the value, co-sign what came from outside.</p>
        <a className="btn primary" href="#benchmark" onClick={(e) => { e.preventDefault(); go("benchmark"); }}>READ THE BENCHMARK <span>↗</span></a>
        <a className="btn ghost" href="#install" onClick={(e) => { e.preventDefault(); go("install"); }}>SEE THE CONTRACT <span>▾</span></a>
        <p className="fine">TESTNET ONLY | NO MAINNET FUNDS | TEE STUBBED | 269 TESTS</p>
      </div>
    </section>
  );
}

/* 02 LIVE DEMO */
export function Demo() {
  const c = useRef(clock()).current;
  const [cell, setCell] = useState(8);
  const [ramp, setRamp] = useState<keyof typeof RAMPS>("classic");
  const [gate, setGate] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(52);
  const box = useRef<HTMLDivElement>(null);
  c.paused = paused;
  const drag = (e: React.PointerEvent) => {
    const el = box.current!;
    const move = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); setPos(Math.min(95, Math.max(5, ((ev.clientX - r.left) / r.width) * 100))); };
    move(e.nativeEvent);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const ramps = Object.keys(RAMPS);
  return (
    <section id="demo" className="sec">
      <Eyebrow>FRESHLY FLAGGED / MIND THE PROVENANCE</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>SEE WHO WROTE IT.</span></h2><span className="live"><i /> LIVE</span></div>
      <div className="frame" data-fade>
        <div className="compare" ref={box}>
          <FlowCanvas clock={c} gate={gate} className="cv" />
          <div className="over" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            <div className="solid" />
            <GlyphCanvas clock={c} className="cv" opts={{ cell, ramp: RAMPS[ramp], gate }} />
          </div>
          <span className="tag l">RAW INPUT =(</span>
          <span className="tag r">TAINT VIEW =)</span>
          <button className="handle" style={{ left: `${pos}%` }} onPointerDown={drag} aria-label="Drag to compare">↔</button>
          <i className="divider" style={{ left: `${pos}%` }} />
        </div>
        <div className="ctrl">
          <span className="cl">DENSITY</span>
          <div className="seg">{[8, 16, 32, 64].map((n) => <button key={n} className={cell === n ? "on" : ""} onClick={() => setCell(n)}>{n}PX</button>)}</div>
          <button className="cyc" onClick={() => setRamp(ramps[(ramps.indexOf(ramp) + 1) % ramps.length] as keyof typeof RAMPS)}><span className="cl">GLYPHS</span><b>{ramp.toUpperCase()}</b></button>
          <button className="cyc" onClick={() => setGate(!gate)}><span className="cl">GATE</span><b>{gate ? "ON" : "OFF"}</b></button>
          <button className="cyc" onClick={() => setPaused(!paused)}><span className="cl">MOTION</span><b>{paused ? "PLAY" : "PAUSE"}</b></button>
        </div>
      </div>
      <p className="note" data-fade>White glyphs came from the owner&apos;s signed instruction. Red glyphs came from text the owner did not write. Demonstration only: nothing here moves funds.</p>
    </section>
  );
}

/* 03 WORKFLOW */
const STEPS = [
  { n: "01", t: "PROPOSE", d: "The quarantined planner reads outside text and can only emit typed handles. The worker key proposes a payment with every argument tagged Owner or Untrusted." },
  { n: "02", t: "HOLD", d: "The contract executes owner-class payments inside the daily cap. Anything with an untrusted recipient or amount waits as a pending proposal, with its source line." },
  { n: "03", t: "COSIGN", d: "The owner signs one delegate action. A relayer submits it and pays gas. The signed delegate cannot be replayed. Every approval stays on chain." },
];
export function Workflow() {
  return (
    <section id="workflow" className="sec">
      <Eyebrow>POINT IT / HOLD IT / TAKE IT HOME</Eyebrow>
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
  { k: "B", t: "QUARANTINED EXTRACTOR", m: "TYPED HANDLES", d: "The model that reads attachments and posts never sees wallet tools, and the planner never sees raw outside text. Handles are opaque." },
  { k: "C", t: "PINNED ACCOUNTS", m: "NAMED ONLY", d: "Named accounts the owner pinned count as owner-class. A Cyrillic lookalike is rejected by the parser, and the genuine pin is what gets paid." },
  { k: "D", t: "24 HOUR CAP", m: "5 NEAR / DAY", d: "A leaked worker key can send a capped amount a day, and the owner can pause, remove the worker or withdraw." },
  { k: "E", t: "OWNER CO-SIGN", m: "ONE TAP", d: "Held proposals are approved by the owner, once, or remembered into the address book with a cap." },
  { k: "F", t: "NEP-366 RELAY", m: "NO OWNER GAS", d: "The owner signs a delegate action off chain. The relayer accepts one cosign call, zero deposit, and nothing else." },
  { k: "G", t: "REPLAY GUARD", m: "FLOW HASH", d: "The flow hash derives from the owner's nonce only, so a model that re-plans the same message cannot trigger a second payment." },
  { k: "H", t: "SHARED POLICY CASES", m: "TS = RUST", d: "20 shared cases pin the rule table. The TypeScript mock and the Rust contract must agree on every one." },
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
      <Eyebrow>HOUSE BOARD / EIGHT GOOD REASONS</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>THE WHOLE ROUND.</span></h2>
        <p className="aside" data-fade>One agent. Two classes of value. Eight parts. Zero trust in outside text.</p></div>
      <div className="split" data-fade>
        <ul className="grid8">
          {FEATURES.map((x, j) => (
            <li key={x.k}><button className={j === i ? "on" : ""} onMouseEnter={() => setI(j)} onClick={() => setI(j)}>
              <span className="k">[{x.k}]</span><span className="t">{x.t}</span><span className="m">{x.m}</span></button></li>
          ))}
        </ul>
        <div className="detail" ref={panel}>
          <span className="k" data-sw>[{f.k}]</span><span className="m" data-sw>{f.m}</span>
          <h3 data-sw>{f.t}</h3>
          <p data-sw>{f.d}</p>
        </div>
      </div>
    </section>
  );
}

/* 05 INTERFACE */
const TABS = ["CORE", "POLICY", "PINS", "COSIGN"];
const POLICY: Record<string, [string, string][]> = {
  POLICY: [["OWNER-CLASS VALUE", "EXECUTES IN CAP"], ["UNTRUSTED VALUE", "HELD"], ["AMBIGUOUS LITERAL", "DEMOTED"], ["MISSING PROVENANCE", "MALFORMED"], ["REPEATED FLOW HASH", "REJECTED"]],
  PINS: [["PINNED NAME", "OWNER-CLASS"], ["LOOKALIKE UNICODE", "REJECTED"], ["RE-PIN", "NEVER LOWERS CAP"], ["REMEMBERED PAYEE", "CAPPED"], ["PENDING TTL", "24 HOURS"]],
  COSIGN: [["SIGNER", "OWNER ONLY"], ["TRANSPORT", "NEP-366 DELEGATE"], ["VALID FOR", "120 BLOCKS"], ["REPLAY", "NONCE REJECTED"], ["GAS", "PAID BY RELAYER"]],
};
export function Interface() {
  const c = useRef(clock()).current;
  const [tab, setTab] = useState("CORE");
  const [gate, setGate] = useState(true);
  const [op, setOp] = useState(100);
  const [cell, setCell] = useState(8);
  const [ramp, setRamp] = useState<keyof typeof RAMPS>("classic");
  const [paused, setPaused] = useState(false);
  c.paused = paused;
  return (
    <section id="interface" className="sec">
      <Eyebrow>SIGNAL DESK / HAVE A GO</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>YOU&apos;RE IN CHARGE NOW.</span></h2>
        <p className="aside" data-fade>The contract adds no knobs the policy table does not already pin. Change the view below and watch the gate respond.</p></div>
      <div className="desk" data-fade>
        <div className="deskbar"><span>STREAM SELECTED</span><span>936×425</span><i className="sp" /><span className="live"><i /> {paused ? "PAUSED" : "LIVE"}</span><button onClick={() => setPaused(!paused)}>{paused ? "PLAY" : "PAUSE"}</button></div>
        <div className="deskbody">
          <GlyphCanvas clock={c} className="cv" opts={{ cell, ramp: RAMPS[ramp], gate, base: op / 100 }} />
          <div className="panel">
            <div className="tabs">{TABS.map((t, i) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}><small>{String(i + 1).padStart(2, "0")}</small>{t}</button>)}</div>
            {tab === "CORE" ? (
              <div className="pbody">
                <div className="row"><b className="red">PROVENANCE GATE</b><button className="tg" onClick={() => setGate(!gate)}>{gate ? "ON" : "OFF"}</button></div>
                <div className="row"><span>OPACITY</span><input type="range" min={10} max={100} value={op} onChange={(e) => setOp(+e.target.value)} /><small>{op}%</small></div>
                <p className="gl">DENSITY</p>
                <div className="g2">{[8, 16, 32, 64].map((n) => <button key={n} className={cell === n ? "on" : ""} onClick={() => setCell(n)}>{n}PX</button>)}</div>
                <p className="gl">GLYPH RAMP</p>
                <div className="g2">{Object.keys(RAMPS).slice(0, 4).map((r) => <button key={r} className={ramp === r ? "on" : ""} onClick={() => setRamp(r as keyof typeof RAMPS)}>{r.toUpperCase()}</button>)}</div>
              </div>
            ) : (
              <ul className="pbody kv">{POLICY[tab].map(([a, b]) => <li key={a}><span>{a}</span><b>{b}</b></li>)}</ul>
            )}
          </div>
        </div>
        <div className="deskfoot"><span>SAME POLICY TABLE</span><span>20 SHARED CASES</span><span>TS / RUST / JSON</span><span>TESTNET ONLY</span></div>
      </div>
    </section>
  );
}

/* 06 PRIVACY (light) */
const FACTS: [string, string][] = [["ACTIVATION", "OWNER CO-SIGN"], ["WORKER CAP", "5 NEAR / 24H"], ["NETWORK", "TESTNET ONLY"], ["TEE ATTESTATION", "STUBBED"], ["CONTRACT KEY", "STILL HELD"]];
export function Privacy() {
  return (
    <section id="privacy" className="light">
      <div className="pv">
        <div className="pv-num" data-count="0">00</div>
        <div className="pv-main">
          <i className="blob" aria-hidden />
          <div className="pv-copy">
            <p className="eyebrow">WHAT THE MODEL READS / STAYS UNTRUSTED</p>
            <h2><span data-scramble>YOUR MONEY NEVER BECOMES THEIR DECISION.</span></h2>
            <p>Outside text can suggest a payment. It cannot make one. Values from that text stay untrusted, so the contract holds them until you co-sign. Everything here runs on testnet. The attestation is a stub and the contract account still holds its full-access key, and the repo says so.</p>
            <p className="links"><a href="#faq" onClick={(e) => { e.preventDefault(); go("faq"); }}>READ THE FAQ ↗</a> <a href="#benchmark" onClick={(e) => { e.preventDefault(); go("benchmark"); }}>INSPECT THE NUMBERS ↗</a></p>
          </div>
        </div>
        <ul className="pv-facts" data-stagger>{FACTS.map(([a, b]) => <li key={a}><small>{a}</small><b>{b}</b></li>)}</ul>
      </div>
    </section>
  );
}

/* 07 BENCHMARK (browser list) */
const BENCH = [
  { n: "01", t: "Naive", m: "Replay | live model | F1, F3", r: "DRAINED 10/10" },
  { n: "02", t: "Allowlist+Caps", m: "Replay | live model | all four", r: "BLOCKED 10/10" },
  { n: "03", t: "TAINT", m: "Replay | live model | L1, L2 done 10/10", r: "HELD 8-9/10" },
  { n: "04", t: "Red team", m: "120 live attempts | 2 models", r: "0 FAILURES" },
  { n: "05", t: "Contract", m: "Rust | testnet | NEP-366 cosign", r: "SOURCE BUILD" },
];
export function Benchmark() {
  const [h, setH] = useState<number | null>(null);
  return (
    <section id="benchmark" className="sec">
      <Eyebrow>ONE FOR EVERY AGENT / NEARLY</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>SAME MODEL.</span><br /><span data-scramble>DIFFERENT HANDS.</span></h2>
        <p className="aside" data-fade>We ran gpt-oss-120b against each wallet. Payments were simulated and the model was real. The allowlist blocked the useful payments too; the ties and misses are in the log.</p></div>
      <ul className="rows" data-stagger onMouseLeave={() => setH(null)}>
        {BENCH.map((b, i) => (
          <li key={b.n} className={(h === null ? i === 2 : h === i) ? "on" : ""} onMouseEnter={() => setH(i)}>
            <span className="n">{b.n}</span><span className="name">{b.t}</span><span className="meta">{b.m}</span><span className="res">{b.r} ↗</span>
          </li>
        ))}
      </ul>
      <p className="note">Model: openai/gpt-oss-120b on Groq. 120 agent runs, 0 error rows. Fixtures were chosen by the authors, one model and one provider. See bench/RESULTS.md.</p>
    </section>
  );
}

/* 08 ECOSYSTEM */
const ECO = [
  { c: "READ", u: "README.md", d: "What TAINT claims, and what it does not." },
  { c: "RUN", u: "npm run replay", d: "Naive vs allowlist vs TAINT, mock or live model." },
  { c: "ATTACK", u: "npm run redteam", d: "Twelve attacks. Judged on whether funds moved." },
  { c: "COSIGN", u: "npm run cosign-web", d: "Approve a held payment from the browser on testnet." },
  { c: "AUDIT", u: "bench/RESULTS.md", d: "Every run, every miss, every unfinished item." },
];
export function Ecosystem() {
  const [h, setH] = useState(2);
  return (
    <section id="ecosystem" className="sec">
      <Eyebrow>PUB CRAWL / MORE COMMANDS THIS WAY</Eyebrow>
      <div className="titlebar"><h2><span data-scramble>DON&apos;T GO HOME YET.</span></h2>
        <p className="aside" data-fade>The wallet is one half. Keep going with the benchmark, the red team and the co-sign page.</p></div>
      <ul className="eco" data-stagger onMouseLeave={() => setH(2)}>
        {ECO.map((e, i) => (
          <li key={e.u} className={h === i ? "on" : ""} onMouseEnter={() => setH(i)}>
            <span className="c">{e.c}</span><span className="u">{e.u}</span><span className="d">{e.d}</span><span className="ar">↗</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 09 FAQ */
const FAQ = [
  { q: "WHAT DOES TAINT STOP?", a: "A model fooled by text it read, such as an email, a post or an attachment, paying an account the owner never chose. Values from that text stay untrusted and are held for your co-sign." },
  { q: "WHY NOT JUST AN ALLOWLIST?", a: "An allowlist checks where money goes. It also blocks the useful payments, and it cannot tell who chose an allowed account. In the live replay it blocked every run, including the legitimate ones." },
  { q: "WHERE DO MY KEYS GO?", a: "The worker key proposes and is capped at 5 NEAR a day. The owner key only signs co-sign delegates. The co-sign page uses a demo owner key held by the local server, not a wallet." },
  { q: "WHAT IS NOT DONE YET?", a: "Mainnet, wallet signing in the browser, a real TEE attestation, and deleting the contract's full-access key. The decision record says so." },
  { q: "WHAT DOES THE BENCHMARK PROVE?", a: "That with one live model and four fixtures, TAINT held or did nothing on attacks and completed the legitimate flows. It does not prove safety against every attack." },
  { q: "IS IT REALLY OPEN?", a: "Yes. MIT licensed, with the TypeScript runtime, the Rust contract and every result file in the repository." },
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
      <Eyebrow>BAR CHAT / STRAIGHT ANSWERS</Eyebrow>
      <h2><span data-scramble>THE USUAL, PLEASE.</span></h2>
      <div className="split faq" data-fade>
        <ul className="qs">{FAQ.map((f, j) => <li key={f.q}><button className={j === i ? "on" : ""} onClick={() => setI(j)}><small>{String(j + 1).padStart(2, "0")}</small>{f.q}</button></li>)}</ul>
        <div className="detail" ref={p}>
          <small data-sw>{String(i + 1).padStart(2, "0")}</small><small className="r" data-sw>ANSWER</small>
          <h3 data-sw>{FAQ[i].q.replace(/(.{14,}?)\s/, "$1\n")}</h3>
          <p data-sw>{FAQ[i].a}</p>
        </div>
      </div>
    </section>
  );
}

/* 10 INSTALL + footer (light) */
export function Install() {
  const c = useRef(clock()).current;
  return (
    <section id="install" className="light end">
      <GlyphCanvas clock={c} follow className="end-canvas" opts={{ cell: 14, ramp: RAMPS.classic, light: true, base: 1.1 }} />
      <div className="end-in">
        <p className="eyebrow">PULL THE TAP / MAKE IT RAIN</p>
        <h2><span data-scramble>MAKE EACH SPEND</span><br /><Glitch word="ACCOUNTABLE" /></h2>
        <a className="btn outline" href="#" onClick={(e) => e.preventDefault()}>CLONE THE REPO - FREE <span>↗</span></a>
      </div>
      <footer className="foot">
        <div><b>▣ TAINT</b><p>(c) 2026 TAINT</p></div>
        <div><u>BUILD</u><p>README.md</p><p>PRD.md</p></div>
        <div><u>VERIFY</u><p>bench/RESULTS.md</p><p>docs/decisions</p></div>
        <div><u>NETWORK</u><p>taint-myname.testnet</p><p>NEAR testnet only</p></div>
        <div className="fine"><p>MONOGRAM-STYLE TYPE VIA GOOGLE FONTS</p><p>BUILT WITH NEXT.JS, GSAP AND LENIS</p></div>
      </footer>
    </section>
  );
}

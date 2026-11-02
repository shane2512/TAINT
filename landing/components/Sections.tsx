"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import Dashboard, { useCount } from "./Dashboard";
import { Halftone, Tendril } from "./Halftone";
import { go, REPO } from "./Shell";
import { api, Icon, Mark } from "./ui";

/* ---------- small pieces ---------- */


function Lines({ lines, as: Tag = "h2", className }: { lines: string[]; as?: "h1" | "h2"; className?: string }) {
  return (
    <Tag className={className} data-lines aria-label={lines.join(" ")}>
      {lines.map((l) => <span className="ln" key={l} aria-hidden><span>{l}</span></span>)}
    </Tag>
  );
}

/** Random-looking code that keeps changing: here, the handle an outside value was given. */
function Scramble({ side }: { side: "l" | "r" }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789abcdefghjkmnpqrstuvwxyz";
    const make = () => Array.from({ length: 3 + ((Math.random() * 2) | 0) }, () => A[(Math.random() * A.length) | 0]).join("");
    el.textContent = make();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const t = setInterval(() => visible && (el.textContent = make()), 95);
    return () => { clearInterval(t); io.disconnect(); };
  }, []);
  return (
    <span className={`scr ${side}`} aria-hidden>
      {side === "l" && <Icon name="right" size={26} />}
      <span ref={ref} />
      {side === "r" && <span className="flip"><Icon name="right" size={26} /></span>}
    </span>
  );
}

/* ---------- hero ---------- */

export function Hero() {
  return (
    <section id="top" className="hero" data-hero>
      <div className="hero-glow" aria-hidden />
      <div className="frame">
        <i className="guide gl" /><i className="guide gr" />
        
        <div className="hero-copy">
          <div>
            <Lines as="h1" lines={["Check who decided", "every payment."]} />
          </div>
          <div className="hero-side" data-reveal="0.15">
            <p>Allowlists check where money goes. TAINT checks who decided. Values an AI agent read in outside text wait for your co-sign, on NEAR testnet.</p>
            <div className="hero-btns">
              <Link className="btn solid" href="/demo">Try the demo <Icon name="right" size={12} /></Link>
              <a className="btn ghost" href={REPO} target="_blank" rel="noreferrer">View the code</a>
            </div>
          </div>
        </div>
        <ol className="receipt" aria-label="Example proposal: a transfer held because its recipient came from outside text">
          <li><small>Action</small><b>Transfer</b></li>
          <li className="untrusted"><small>Recipient</small><b>attacker.testnet</b><em>Untrusted · x.com/@attacker</em></li>
          <li className="owner"><small>Amount</small><b>1.5 NEAR</b><em>Owner · your signed instruction</em></li>
          <li className="ruling"><small>Contract says</small><b>Held for your co-sign</b></li>
        </ol>
      </div>
      <div className="hero-art" aria-hidden>
        <Halftone scene="dusk" cell={14} seed={5} className="hero-dots" rise />
      </div>
      <div className="hero-dash"><Dashboard variant="hero" to={1.5} /></div>
    </section>
  );
}

/* ---------- how it works + the rules widget ---------- */

const STEPS = [
  ["01", "Propose", "A quarantined extractor reads outside text and returns typed values. The planner sees opaque handles. The worker key proposes a payment, every argument tagged owner or outside."],
  ["02", "Hold", "The contract runs owner-chosen payments inside the daily cap. Anything an outside party chose waits as a pending proposal, with its source, for 15 minutes."],
  ["03", "Co-sign", "The owner signs one transaction from their own wallet. A refusal comes back as a refusal, never as an approval. A signed delegate cannot be replayed."],
];

const LABELS: [number, number, string][] = [[2, 1, "OWNER"], [5, 1, "x.com"], [8, 1, "EMAIL"], [11, 1, "PIN"], [3, 2, "BOOK"], [7, 2, "CAP"], [9, 2, "HOLD"], [12, 2, "NEAR"], [1, 4, "OWNER"], [5, 4, "PIN"], [10, 4, "x.com"], [4, 6, "HOLD"], [8, 6, "BOOK"], [11, 6, "EMAIL"]];

interface Verdict { decision: string; reasons: string[] }

export function Widget() {
  const [recipient, setRecipient] = useState("attacker.testnet");
  const [amount, setAmount] = useState("1.5");
  const [label, setLabel] = useState("x.com/@attacker");
  const [recipientFrom, setRecipientFrom] = useState<"Outside" | "Owner">("Outside");
  const [amountFrom, setAmountFrom] = useState<"Outside" | "Owner">("Outside");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const outside = label.trim().toLowerCase() === "owner" ? "outside (named owner)" : label;
    const src = (v: string) => (v === "Owner" ? "owner" : outside);
    const t = setTimeout(async () => {
      try {
        const r = await api<Verdict>("policy/evaluate", { kind: "Transfer", recipient, amountNear: Number(amount || 0).toFixed(1), recipientSource: src(recipientFrom), amountSource: src(amountFrom) });
        if (!live) return;
        if (r.ok) { setVerdict(r.body); setErr(null); } else setErr(r.body.error ?? "Could not evaluate that.");
      } catch {
        if (live) setErr("The runtime did not answer.");
      }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [recipient, amount, label, recipientFrom, amountFrom]);

  const d = verdict?.decision;
  const text = err ? "Runtime offline" : d === "executed" ? "Executes inside the cap" : d === "held" ? "Held for your co-sign" : d === "rejected" ? "Rejected" : "Checking the rules";
  return (
    <div className="swap" data-testid="widget">
      <h3>Propose</h3>
      <div className="swap-sell">
        <small>Pay</small>
        <div className="swap-row">
          <input className="swap-big" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in NEAR" />
          <span className="sel">NEAR <Icon name="chev" size={11} /></span>
        </div>
        <div className="swap-sub">
          <label>to <input value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Recipient" spellCheck={false} /></label>
          <span className="seg2" role="group" aria-label="Who chose the amount">
            amount chosen by
            {(["Owner", "Outside"] as const).map((o) => <button key={o} className={amountFrom === o ? "on" : ""} aria-pressed={amountFrom === o} onClick={() => setAmountFrom(o)}>{o}</button>)}
          </span>
        </div>
      </div>
      <button className="swap-flip" aria-label="Flip who chose the recipient" onClick={() => setRecipientFrom(recipientFrom === "Outside" ? "Owner" : "Outside")}><Icon name="lr" size={15} /></button>
      <div className="swap-buy">
        <small>Recipient chosen by</small>
        <div className="swap-row">
          <input className="swap-big" value={recipientFrom === "Owner" ? "owner" : label} onChange={(e) => setLabel(e.target.value)} disabled={recipientFrom === "Owner"} aria-label="Where the recipient came from" spellCheck={false} />
          <button className="sel black" onClick={() => setRecipientFrom(recipientFrom === "Outside" ? "Owner" : "Outside")} aria-label={`Recipient chosen by ${recipientFrom}`}>{recipientFrom} <Icon name="chev" size={11} /></button>
        </div>
        <div className="swap-sub"><span>Real rules, simulated payment</span><span>{d === "held" ? "needs your co-sign" : d === "executed" ? "no co-sign needed" : ""}</span></div>
      </div>
      <div className={`swap-go ${d ?? ""}`} data-testid="widget-verdict" data-decision={d ?? ""} aria-live="polite">{text}</div>
      <ul className="swap-why" data-testid="widget-reasons">{err ? <li>{err}</li> : verdict?.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}

function Sprites({ cols, rows }: { cols: number; rows: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    const kids = Array.from(el.children) as HTMLElement[];
    const place = (k: HTMLElement) => {
      const c = 1 + ((Math.random() * (cols - 2)) | 0), r = (Math.random() * rows) | 0;
      k.style.left = `${(c / cols) * 100}%`;
      k.style.top = `${(r / rows) * 100}%`;
      k.style.transform = `rotate(${((Math.random() * 4) | 0) * 90}deg)`;
    };
    kids.forEach((k, i) => { place(k); k.style.opacity = i % 2 ? "1" : "0"; });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let n = 0;
    const t = setInterval(() => {
      const k = kids[n++ % kids.length];
      gsap.to(k, { autoAlpha: 0, scale: 0.8, duration: 0.5, onComplete: () => { place(k); gsap.to(k, { autoAlpha: 1, scale: 1, duration: 0.7, ease: "power2.out" }); } });
    }, 1300);
    return () => clearInterval(t);
  }, [cols, rows]);
  return (
    <div className="sprites" ref={box} aria-hidden style={{ ["--cols" as string]: cols, ["--rows" as string]: rows }}>
      {[1, 2, 3, 4, 5, 6].map((s) => <Tendril key={s} seed={s} className="spr" />)}
    </div>
  );
}

export function How() {
  const COLS = 12, ROWS = 7;
  return (
    <section id="how" className="sec">
      <div className="frame">
        <Lines lines={["Say who decided.", "The contract answers."]} />
        <ol className="steps" data-stagger>
          {STEPS.map(([n, t, d]) => <li key={n}><span className="n">{n}</span><h3>{t}</h3><p>{d}</p></li>)}
        </ol>
      </div>
      <div className="stage" data-stage>
        <div className="gridbg" aria-hidden />
        {LABELS.map(([c, r, t]) => <span key={`${c}${r}`} className="glabel" style={{ left: `${(c / COLS) * 100}%`, top: `${(r / ROWS) * 100}%` }}>{t}</span>)}
        <Sprites cols={COLS} rows={ROWS} />
        <Scramble side="l" />
        <Scramble side="r" />
        <Widget />
      </div>
    </section>
  );
}

/* ---------- modes (the two plan cards) ---------- */

export function Modes() {
  return (
    <section id="modes" className="sec modes">
      <div className="frame">
        <Lines lines={["Choose how you", "run it."]} />
        <div className="plans" data-stagger>
          <article className="plan dark" data-testid="mode-sim">
            <p className="plan-tag"><i />SIMULATED</p>
            <h3 className="plan-name">No wallet needed</h3>
            <p className="plan-lede">Try it with no wallet. Three agents, one attack, the real rules. Payments are simulated.</p>
            <h4>Includes</h4>
            <ul>
              <li><Icon name="right" size={12} />Rob the Pet: three wallets, five fixtures</li>
              <li><Icon name="right" size={12} />The policy desk and the shared rule table</li>
              <li><Icon name="right" size={12} />Twelve red-team attacks, run live</li>
              <li><Icon name="right" size={12} />A private wallet for each visitor</li>
            </ul>
            <Link className="btn solid" href="/demo">Try the demo <Icon name="right" size={12} /></Link>
          </article>
          <article className="plan hot" data-testid="mode-testnet">
            <div className="plan-bg" aria-hidden />
            <p className="plan-tag"><i />TESTNET</p>
            <h3 className="plan-name">Your wallet, a 5 NEAR daily cap</h3>
            <p className="plan-lede">The real contract. Your own wallet signs the approval. A leaked worker key can send at most the daily cap.</p>
            <h4>Includes</h4>
            <ul>
              <li><Icon name="right" size={12} />Held payments read from the contract</li>
              <li><Icon name="right" size={12} />Your wallet signs, no key on this site</li>
              <li><Icon name="right" size={12} />A rolling 24 hour cap, per address too</li>
              <li><Icon name="right" size={12} />Every approval on the block explorer</li>
              <li><Icon name="right" size={12} />Pause, revoke and withdraw for the owner</li>
            </ul>
            <Link className="btn solid" href="/cosign">Approve with your wallet <Icon name="right" size={12} /></Link>
          </article>
        </div>
        <p className="fine" data-reveal>Neither mode touches mainnet. The attestation is stubbed. The contract account has no keys, so only the owner can change it; both are stated in the README.</p>
      </div>
    </section>
  );
}

/* ---------- results (the stats grid) ---------- */

export interface ResultStats { held: number; heldOf: number; legit: number; legitOf: number; redFail: number; redOf: number; cases: number }

function Stat({ value, label, icon, art, decimals = 0, suffix = "" }: { value: number; label: string; icon?: React.ReactNode; art?: "orb" | "waves"; decimals?: number; suffix?: string }) {
  const ref = useCount(value, decimals, { start: "top 85%", delay: 0 });
  return (
    <div className="cell stat">
      {art && <Halftone scene={art} cell={art === "orb" ? 7 : 6} seed={value + 3} className="cell-art" wave={0.1} />}
      <p className="stat-n"><span ref={ref} />{suffix}</p>
      <small>{label}</small>
      {icon && <span className="corner">{icon}</span>}
    </div>
  );
}

const Brackets = ({ children }: { children: React.ReactNode }) => (
  <span className="brk"><i /><i /><i /><i />{children}</span>
);
const IcCheck = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="5" /><path d="M10 12l1.5 1.5L14 10.5" /></svg>;
const IcTimer = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><circle cx="12" cy="13" r="5" /><path d="M12 10v3l2 1M10.5 6h3" /></svg>;

export function Results({ s }: { s: ResultStats }) {
  return (
    <section id="results" className="sec">
      <div className="frame">
        <h2 className="two" data-lines aria-label="Tested against a real model, with the misses published.">
          <span className="ln"><span>Tested against a real model, three wallets and one attack.</span></span>{" "}
          <span className="ln dim"><span>The misses are published too.</span></span>
        </h2>
        <div className="statgrid" data-stagger data-testid="statgrid">
          <Stat value={s.held} label={`attack runs held, of ${s.heldOf} (live model)`} art="orb" />
          <Stat value={s.redFail} label={`failures in ${s.redOf} live red-team attempts`} icon={<Brackets>{IcCheck}</Brackets>} />
          <Stat value={s.legit} label={`legitimate payments done, of ${s.legitOf}`} icon={<Brackets>{IcTimer}</Brackets>} />
          <Stat value={s.cases} label="shared policy cases, one table for Rust and TypeScript" art="waves" />
          <figure className="cell quote wide"><blockquote>“One model, one provider, four fixtures the authors chose. The misses are in the log.”</blockquote><figcaption><b>What the benchmark does not prove</b><small>bench/RESULTS.md</small></figcaption></figure>
        </div>
        <p className="fine" data-reveal>From the saved run files when this site was built. <Link href="/results">Read every row <Icon name="ne" size={11} /></Link></p>
      </div>
    </section>
  );
}

/* ---------- faq ---------- */

const FAQ = [
  ["What does TAINT stop?", "A model fooled by text it read, such as an email, a post or a token listing, paying an account you never chose. Values from that text stay untrusted and wait for your co-sign."],
  ["Why not just an allowlist?", "An allowlist checks where money goes, so it cannot tell who chose an allowed account. In the live replay it also blocked every legitimate payment."],
  ["Where do my keys go?", "The worker key only proposes, and its spending is capped. Your owner key stays in your wallet, which signs the co-sign. This site holds no key."],
  ["What is not done yet?", "Mainnet and a real TEE attestation. The contract account's last key was deleted, so no key can bypass the policy, but the owner account can still upgrade the contract and withdraw. The decision record says so."],
  ["What does the benchmark prove?", "That with one live model and four fixtures, TAINT held or did nothing on attacks and finished the legitimate payments. It does not prove safety against every attack."],
  ["Is it really open?", "Yes. MIT licensed: the runtime, the Rust contract and every result file are in one repository."],
];

export function Faq() {
  const [open, setOpen] = useState(0);
  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    bodies.current.forEach((b, i) => b && gsap.to(b, { height: i === open ? "auto" : 0, opacity: i === open ? 1 : 0, duration: 0.55, ease: "power3.inOut" }));
  }, [open]);
  return (
    <section id="faq" className="sec">
      <div className="frame">
        <Lines lines={["Straight answers,", "including the awkward ones."]} />
        <div className="faq" data-stagger>
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`faq-row ${open === i ? "on" : ""}`}>
              <button className="faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}><span>{q}</span><Icon name={open === i ? "minus" : "plus"} size={16} /></button>
              <div className="faq-a" ref={(el) => { bodies.current[i] = el; }} style={{ height: i === 0 ? "auto" : 0 }}><p>{a}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- closing call, with the product window ---------- */

export function Cta() {
  return (
    <section id="try" className="cta">
      <div className="frame cta-in">
        <div className="cta-copy">
          <Lines lines={["Let's try", "to rob it"]} />
          <p data-reveal>Send a real attack at three wallets built on the same model. See which one pays, and read why the others did not.</p>
          <Link className="btn solid" href="/results" data-reveal="0.1">View results <Icon name="right" size={12} /></Link>
        </div>
        <div className="cta-dash" data-parallax="40"><Dashboard variant="cta" from={0} to={1.5} /></div>
      </div>
      <Halftone scene="dusk" cell={14} seed={9} className="cta-dots" rise />
    </section>
  );
}

/* ---------- footer ---------- */

const COLS = [
  ["Product", [["Rob the Pet", "/demo"], ["Co-sign", "/cosign"], ["Wallet", "/wallet"], ["Policy", "/policy"]]],
  ["Proof", [["Red team", "/redteam"], ["Results", "/results"], ["Benchmark", "#results"], ["Testnet transactions", "/results"]]],
  ["Build", [["README", `${REPO}#readme`], ["Contract", `${REPO}/tree/main/contract`], ["Runtime", `${REPO}/tree/main/runtime`], ["Decision records", `${REPO}/tree/main/docs/decisions`]]],
  ["Network", [["taint-myname.testnet", "https://testnet.nearblocks.io/address/taint-myname.testnet"], ["NEAR testnet only", "/results"], ["Attestation stubbed", `${REPO}/blob/main/docs/decisions/0001-attestation.md`], ["MIT license", `${REPO}/blob/main/LICENSE`]]],
] as const;

export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`foot ${compact ? "compact" : ""}`} id="footer">
      {!compact && <Halftone scene="dusk" cell={14} seed={12} className="foot-dots" rise />}
      <div className="frame foot-grid">
        <div className="foot-brand">
          <p className="logo"><Mark size={30} /><span>TAINT</span></p>
          <p>Check who decided. A provenance-gated wallet for AI agents, built on NEAR testnet.</p>
          <a className="soc" href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub"><Icon name="github" size={16} /></a>
        </div>
        {COLS.map(([h, links]) => (
          <div key={h} className="foot-col">
            <h4>{h}</h4>
            {links.map(([t, href]) => href.startsWith("/") ? <Link key={t} href={href}>{t}</Link> : <a key={t} href={href} {...(href.startsWith("#") ? { onClick: (e: React.MouseEvent) => { e.preventDefault(); go(href.slice(1)); } } : { target: "_blank", rel: "noreferrer" })}>{t}</a>)}
          </div>
        ))}
        <div className="foot-base">
          <span>© 2026 TAINT. MIT LICENSE.</span>
          <span className="legal"><Link href="/results">RESULTS</Link><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">LICENSE</a><a href={REPO} target="_blank" rel="noreferrer">SOURCE</a></span>
          <button onClick={() => go("top")} className="totop">BACK TO TOP <span><Icon name="up" size={12} /></span></button>
        </div>
      </div>
    </footer>
  );
}

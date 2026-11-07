// Renders docs/img/{poster,techstack,userflow}.png (1920x1080, 16:9).
// Run: node docs/assets/build.mjs   (needs playwright, already a dev dependency of landing/)
// Look = the site and the launch video: #07080c, grid, orange glow, Inter Tight, square corners.
import { chromium } from "../../landing/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "img");
mkdirSync(out, { recursive: true });

// Official marks. Single-path Simple Icons get a fill; the others keep their own colours.
const svgFile = (n) => readFileSync(path.join(here, "logos", n + ".svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const mono = (n, fill) => svgFile(n).replace("<svg ", `<svg fill="${fill}" `);
const png = (n) => `<img src="${pathToFileURL(path.join(here, "logos", n + ".png"))}" />`;
const L = {
  near: mono("near", "#fff"), nearai: svgFile("nearai"), groq: svgFile("groq"),
  meteor: png("meteor-wallet"), mnw: png("my-near-wallet"),
  next: mono("nextdotjs", "#fff"), ts: mono("typescript", "#3178C6"), node: mono("nodedotjs", "#5FA04E"),
  rust: mono("rust", "#fff"), vercel: mono("vercel", "#fff"), render: mono("render", "#fff"),
  gsap: mono("greensock", "#0AE448"), vitest: mono("vitest", "#6E9F18"), pw: svgFile("playwright"),
  intel: mono("intel", "#0068B5"),
};

const font = (w) => `@font-face{font-family:"Inter Tight";font-weight:${w};src:url("${pathToFileURL(path.join(here, "src", `InterTight-${w}.woff2`))}") format("woff2")}`;
const css = `
${[400, 500, 600].map(font).join("")}
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap");
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#07080c;--card:#111318;--line:rgba(255,255,255,.1);--line2:rgba(255,255,255,.17);--dim:#8d9099;--soft:#c9cbd1;--orange:#ec4a14;--hot:#ff6a3d;--ink:#0b0c10;--mono:"JetBrains Mono",ui-monospace,monospace}
html,body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:#fff;font-family:"Inter Tight","Helvetica Neue",Arial,sans-serif;letter-spacing:-.011em;-webkit-font-smoothing:antialiased}
.page{position:absolute;inset:0;overflow:hidden}
.grid{position:absolute;inset:-120px;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:120px 120px;-webkit-mask-image:radial-gradient(80% 80% at 50% 50%,#000 30%,transparent 100%);mask-image:radial-gradient(80% 80% at 50% 50%,#000 30%,transparent 100%)}
.glow{position:absolute;inset:0;background:radial-gradient(55% 42% at 50% 108%,rgba(217,106,44,.55) 0%,rgba(125,48,22,.3) 40%,transparent 72%)}
.top{position:absolute;left:96px;right:96px;top:52px;display:flex;align-items:center;justify-content:space-between;z-index:5}
.brand{display:inline-flex;align-items:center;gap:14px;font-size:30px;font-weight:500;letter-spacing:-.03em}
.chap{font-size:26px;font-weight:500;color:var(--dim)}.chap b{color:var(--orange);font-weight:600;margin-right:12px}
h1{font-weight:500;letter-spacing:-.035em;line-height:1.02}
.gl{font-size:22px;font-weight:500;color:var(--dim);letter-spacing:.06em;text-transform:uppercase}
.mono{font-family:var(--mono)}
.card{background:rgba(17,19,24,.85);border:1px solid var(--line2);position:absolute}
.pill{display:inline-block;font-weight:600;font-size:20px;letter-spacing:.06em;padding:6px 11px;text-transform:uppercase;border-radius:2px;white-space:nowrap}
.pill.bad{background:var(--orange);color:#fff}.pill.held{background:#fff;color:var(--ink)}.pill.good{border:1px solid rgba(255,255,255,.5)}
.lg{display:flex;align-items:center;justify-content:center;flex:none;width:56px;height:56px}
.lg svg,.lg img{width:100%;height:100%;display:block}
.lg img{border-radius:12px}.lg.sq svg{border-radius:10px}
.foot{position:absolute;left:96px;right:96px;bottom:40px;display:flex;justify-content:space-between;font-size:22px;color:var(--dim);z-index:5}
.mark{color:#fff}
`;
const mark = `<svg class="mark" width="36" height="36" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1" fill="currentColor"/><rect x="9.5" y="8" width="5" height="9" fill="currentColor"/><circle cx="12" cy="20" r="2.6" fill="#ec4a14"/></svg>`;
const top = (n, label) => `<div class="top"><div class="brand">${mark}TAINT</div><div class="chap"><b>${n}</b>${label}</div></div>`;
const wrap = (body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="page"><div class="grid"></div><div class="glow"></div>${body}</div>`;

// ---------- poster ----------
const built = [L.near, L.nearai, L.rust, L.ts, L.next, L.meteor].map((l) => `<div class="lg">${l}</div>`).join("");
const poster = wrap(`${top("NEAR HACKATHON", "Nov 2026")}
<div style="position:absolute;left:96px;top:320px;width:1760px">
<div class="gl" style="color:var(--hot);font-size:26px">Provenance-gated wallets for AI agents</div>
<h1 style="font-size:110px;margin-top:30px;color:var(--soft)">Allowlists check <span style="color:#fff">where</span> money goes.</h1>
<h1 style="font-size:110px;margin-top:6px">TAINT checks <span style="color:var(--orange)">who decided.</span></h1>
<p style="font-size:34px;color:var(--soft);margin-top:40px">Naive agent drained <b style="color:#fff">20 of 20</b>. TAINT executed <b style="color:var(--hot)">0 of 20</b>.</p>
</div>
<div style="position:absolute;left:96px;bottom:100px;display:flex;align-items:center;gap:28px"><span class="gl">Built on</span><div style="display:flex;gap:22px;align-items:center">${built}</div></div>
<div class="foot"><span class="mono">taint.shinc.tech</span><span>Live on NEAR testnet</span></div>`);

// ---------- tech stack ----------
const item = (logo, name, role, sq) => `<div style="display:flex;align-items:center;gap:20px;padding:16px 20px;border:1px solid var(--line);background:rgba(7,8,12,.6)"><div class="lg ${sq ? "sq" : ""}">${logo}</div><div><div style="font-size:30px;font-weight:500;letter-spacing:-.03em;line-height:1.1">${name}</div><div style="font-size:21px;color:var(--dim);line-height:1.25;margin-top:3px">${role}</div></div></div>`;
const col = (x, n, title, items, hot) => `<div class="card" style="left:${x}px;top:250px;width:328px;height:660px;padding:24px 20px;${hot ? "border-color:var(--orange);background:rgba(236,74,20,.07)" : ""}"><div class="gl" style="${hot ? "color:var(--hot)" : ""}">${n}</div><div style="font-size:36px;font-weight:500;letter-spacing:-.035em;margin:6px 0 20px">${title}</div><div style="display:grid;gap:12px">${items.join("")}</div></div>`;
const stack = wrap(`${top("TECH", "What it runs on")}
<h1 style="position:absolute;left:96px;top:124px;font-size:68px">The stack, <span style="color:var(--dim)">layer by layer.</span></h1>
${col(96, "01", "Wallet", [item(L.meteor, "Meteor Wallet", "Signs every run (NEP-413)", 1), item(L.mnw, "MyNearWallet", "Co-signs held payments", 1)])}
${col(446, "02", "Site", [item(L.next, "Next.js", "Landing, wallet, red team"), item(L.ts, "TypeScript", "Strict, end to end"), item(L.gsap, "GSAP", "Scroll and motion"), item(L.vercel, "Vercel", "Hosts the site")])}
${col(796, "03", "Runtime", [item(L.node, "Node.js", "Quarantined agent runtime"), item(L.nearai, "NEAR AI Cloud", "Model in a TEE, signed replies", 1), item(L.groq, "Groq", "Fallback model host", 1), item(L.render, "Render", "Hosts the API")])}
${col(1146, "04", "Chain", [item(L.near, "NEAR Protocol", "Policy contract, NEP-413, NEP-366"), item(L.rust, "Rust", "Contract + mock DEX, 100 unit tests")], 1)}
${col(1496, "05", "Assurance", [item(L.intel, "Intel TDX", "Attests the model, not our worker"), item(L.vitest, "Vitest", "TypeScript unit tests"), item(L.pw, "Playwright", "Every page in a real browser")])}
<div class="foot"><span>Logos are trademarks of their owners.</span><span>Worker attestation: not done yet</span></div>`);

// ---------- user flow ----------
const step = (x, n, title, body, chips = "") => `<div class="card" style="left:${x}px;top:236px;width:390px;height:320px;padding:22px 26px"><div class="gl"><span style="color:var(--orange);font-weight:600">${n}</span> &nbsp;${title.k}</div><div style="font-size:38px;font-weight:500;letter-spacing:-.035em;margin:8px 0 10px;line-height:1.05">${title.t}</div><div style="font-size:23px;line-height:1.35;color:var(--soft)">${body}</div><div style="position:absolute;left:26px;bottom:20px;display:flex;gap:12px;align-items:center">${chips}</div></div>`;
const out1 = (x, y, w, k, t, body, style = "") => `<div class="card" style="left:${x}px;top:${y}px;width:${w}px;height:228px;padding:20px 24px;${style}"><div class="gl" style="${style.includes("orange") ? "color:var(--hot)" : ""}">${k}</div><div style="font-size:36px;font-weight:500;letter-spacing:-.035em;margin:6px 0 8px;line-height:1.05">${t}</div><div style="font-size:22px;line-height:1.35;color:var(--soft)">${body}</div></div>`;
const lg = (l, sq) => `<div class="lg ${sq ? "sq" : ""}" style="width:44px;height:44px">${l}</div>`;
const arrow = (d, c = "#fff") => `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5" marker-end="url(#a${c === "#fff" ? "w" : "o"})"/>`;
const flow = wrap(`${top("FLOW", "From instruction to payment")}
<h1 style="position:absolute;left:96px;top:124px;font-size:68px">One payment, <span style="color:var(--dim)">start to finish.</span></h1>
<svg style="position:absolute;inset:0;z-index:2" width="1920" height="1080"><defs>
<marker id="aw" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fff"/></marker>
<marker id="ao" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ec4a14"/></marker></defs>
${arrow("M486,396 H540")}${arrow("M932,396 H986")}${arrow("M1378,396 H1432")}
${arrow("M1629,556 V644")}
${arrow("M1629,600 H1183 V644", "#ec4a14")}
${arrow("M988,758 H934", "#ec4a14")}${arrow("M542,758 H488", "#ec4a14")}
</svg>
${step(96, "01", { k: "Owner", t: "Sign the instruction" }, "Connect Meteor Wallet, open your own account in the contract, and sign what you want done (NEP&#8209;413). The site holds no keys.", lg(L.meteor, 1))}
${step(542, "02", { k: "Worker", t: "Read in quarantine" }, "An extractor turns outside content into typed handles (<span class='mono' style='font-size:20px'>$h1</span> Account, Token, Amount). The planner sees only handles.", lg(L.nearai, 1) + lg(L.groq, 1))}
${step(988, "03", { k: "Worker", t: "Attach provenance" }, "Every argument is labelled <b>Owner</b> or <b>Untrusted</b> with its full source. A planner cannot mint an Owner value.")}
${step(1434, "04", { k: "Contract", t: "Policy decides" }, "Untrusted recipient passes only if in your address book or pinned. Untrusted token or amount is held. A 24h cap covers everything.", lg(L.near) + lg(L.rust))}
${out1(1434, 644, 390, "Approved path", "Executed", "Owner-sourced, or a pinned recipient within its cap. Scheduled on NEAR.", "")}
${out1(988, 644, 390, "Untrusted path", "Held", "Shows the source line and a lookalike check. Waits up to 15 minutes.", "border-color:var(--orange);background:rgba(236,74,20,.1)")}
${out1(542, 644, 390, "Owner", "Co-sign", "One tap in your wallet. Relayed as a delegate action (NEP-366).", "")}
${out1(96, 644, 390, "Result", "Released", "The payment moves. Ignore it and it expires, nothing moves.", "")}
<div style="position:absolute;left:96px;right:96px;top:910px;display:flex;gap:18px;align-items:center;z-index:3"><span class="pill held">Also refused</span><span style="font-size:24px;color:var(--soft)">over the 24h cap · a replayed run · contract paused · values that never parsed into a handle</span></div>
<div class="foot"><span>Runs on NEAR testnet</span><span class="mono">taint.shinc.tech</span></div>`);

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, html] of [["poster", poster], ["techstack", stack], ["userflow", flow]]) {
  writeFileSync(path.join(here, "src", name + ".html"), html);
  await pg.goto(pathToFileURL(path.join(here, "src", name + ".html")).href, { waitUntil: "networkidle" });
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: path.join(out, name + ".png") });
  console.log("wrote", name + ".png");
}
await b.close();

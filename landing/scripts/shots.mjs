// Screenshots of a running site, scrolled through section by section so the entrance animations have played.
// usage: node scripts/shots.mjs <baseUrl> <outDir> [width] [height] [paths,comma,separated]
import fs from "node:fs";
import { chromium } from "@playwright/test";

const [base, out, w = "1400", h = "900", paths = "/"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
for (const path of paths.split(",").map((p) => (p.startsWith("/") ? p : "/" + (p === "home" ? "" : p)))) {
  const name = path === "/" ? "home" : path.slice(1);
  await page.goto(base + path);
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${out}/${name}-0.png` });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  let i = 1;
  for (let y = +h * 0.85; y < total && i < 14; y += +h * 0.85, i++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-${i}.png` });
  }
  console.log(name, "height", total, "shots", i);
}
console.log("errors:", JSON.stringify(errors.slice(0, 6)));
await browser.close();

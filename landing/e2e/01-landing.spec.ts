import { expect, listDir, readJson, test } from "./fixtures";

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => page.goto("/"));

  test("[F01] the hero says what TAINT is, and the limits are stated in the page", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Check who decided");
    await expect(page.locator(".hero-side")).toContainText("TAINT checks who decided");
    await expect(page.locator(".hero-side")).toContainText("NEAR testnet");
    await page.locator("#modes").scrollIntoViewIfNeeded();
    await expect(page.locator("#modes .fine")).toContainText("Neither mode touches mainnet");
    await expect(page.locator("#modes .fine")).toContainText("attestation is stubbed");
  });

  test("[F02] the nav scrolls to its sections and opens the app and the repository", async ({ page }) => {
    for (const [link, id] of [["How it works", "how"], ["Modes", "modes"], ["Results", "results"], ["FAQ", "faq"]]) {
      await page.evaluate(() => window.scrollTo(0, 0)); // the nav is part of the page, as in the design, so go back up to it
      await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(0);
      await page.getByTestId("nav").getByRole("link", { name: link }).click();
      let last = -1;
      await expect(async () => {
        const y = await page.evaluate(() => Math.round(scrollY));
        const settled = y === last;
        last = y;
        expect(settled && y > 0).toBe(true);
      }).toPass({ timeout: 9000, intervals: [400] });
      const top = await page.locator(`#${id}`).evaluate((e) => e.getBoundingClientRect().top);
      expect(Math.abs(top)).toBeLessThan(260);
    }
    await expect(page.getByTestId("nav").getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/shane2512/TAINT");
    await page.getByTestId("nav").getByRole("link", { name: "Try the demo" }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("[F03] the product window in the hero counts its number up and says it is sample data", async ({ page }) => {
    const hero = page.getByTestId("dash-hero");
    await expect(hero).toContainText("SAMPLE DATA");
    await expect(hero.locator(".bignum span")).toHaveText("1.500", { timeout: 9000 });
    await expect(hero).toContainText("Held for co-sign");
  });

  test("[F04] the halftone art is really painted, and moves", async ({ page }) => {
    const sum = () => page.locator(".hero-dots").evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) n += d[i];
      return n;
    });
    await page.waitForTimeout(2800); // it rises in
    const a = await sum();
    expect(a).toBeGreaterThan(50_000);
    await page.waitForTimeout(900);
    expect(await sum()).not.toBe(a);
  });

  test("[F05] the rules widget answers from the real rules", async ({ page }) => {
    const w = page.getByTestId("widget");
    await w.scrollIntoViewIfNeeded();
    const go = page.getByTestId("widget-verdict");
    await expect(go).toHaveAttribute("data-decision", "held");
    await expect(go).toHaveText("Held for your co-sign");
    await expect(page.getByTestId("widget-reasons")).toContainText("recipient from x.com/@attacker");
    await expect(page.getByTestId("widget-reasons")).toContainText("amount from x.com/@attacker");
    await w.getByRole("group", { name: "Who chose the amount" }).getByRole("button", { name: "Owner" }).click();
    await expect(page.getByTestId("widget-reasons")).not.toContainText("amount from");
    await w.getByRole("button", { name: "Flip who chose the recipient" }).click();
    await expect(go).toHaveAttribute("data-decision", "executed");
    await expect(go).toHaveText("Executes inside the cap");
  });

  test("[F06] a source merely named owner is still outside", async ({ page }) => {
    const w = page.getByTestId("widget");
    await w.scrollIntoViewIfNeeded();
    await w.getByLabel("Where the recipient came from").fill("owner");
    await expect(page.getByTestId("widget-verdict")).toHaveAttribute("data-decision", "held");
    await expect(page.getByTestId("widget-reasons")).toContainText("recipient from outside (named owner)");
  });

  test("[F07] the results grid shows the saved live results", async ({ page }) => {
    const file = listDir("bench", "results").filter((f) => f.endsWith("-LIVE.json")).at(-1)!;
    const { rows } = readJson("bench", "results", file);
    const n = (agent: string, kind: string, outcome?: string) => rows.filter((r: any) => r.agent === agent && r.fixture.startsWith(kind) && (!outcome || r.outcome === outcome)).length;
    const redTotal = listDir("bench", "results").filter((f) => /redteam.*\.md$/.test(f)).length * 60;
    const grid = page.getByTestId("statgrid");
    await grid.scrollIntoViewIfNeeded();
    const cells = grid.locator(".stat");
    await expect(cells.nth(0).locator(".stat-n")).toHaveText(String(n("taint", "F", "pending")), { timeout: 9000 });
    await expect(cells.nth(0)).toContainText(`of ${n("taint", "F")}`);
    await expect(cells.nth(1).locator(".stat-n")).toHaveText("0", { timeout: 9000 });
    await expect(cells.nth(1)).toContainText(`in ${redTotal} live red-team attempts`);
    await expect(cells.nth(2).locator(".stat-n")).toHaveText(String(n("taint", "L", "ok")), { timeout: 9000 });
    await expect(grid).toContainText("One model, one provider, four fixtures the authors chose");
    await expect(page.locator("#results .fine")).toContainText("saved run files");
  });

  test("[F08] the footer reaches every page of the app", async ({ page }) => {
    for (const [href, heading] of [["/demo", "Rob the Pet."], ["/cosign", "Pending co-signs."], ["/wallet", "The wallet."], ["/policy", "The policy."], ["/redteam", "The red team."], ["/results", "The results."]]) {
      await page.goto("/");
      const link = page.locator(`#footer a[href="${href}"]`).first();
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
  });

  test("[F09] smooth scroll is on, and the headings slide into place", async ({ page }) => {
    await expect(page.locator("html")).toHaveClass(/lenis/);
    await page.locator("#how").scrollIntoViewIfNeeded();
    const line = page.locator("#how h2 .ln > span").first();
    await expect(async () => {
      const y = await line.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m42);
      expect(Math.abs(y)).toBeLessThan(1);
    }).toPass({ timeout: 6000 });
  });

  test("[F10] nothing from the reference or any made-up claim is left", async ({ page }) => {
    const text = await page.locator("body").innerText();
    for (const gone of [/kraken/i, /suctra/i, /schedule a demo/i, /12,486/, /\$149/, /\$299/, /99\.99%/, /\bunlimited\b/i, /pub crawl/i, /testimonial/i]) expect(text).not.toMatch(gone);
  });

  test("[F76] the two modes lead to the live demo and to the repository", async ({ page }) => {
    await page.locator("#modes").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("mode-testnet")).toContainText("TESTNET");
    await expect(page.getByTestId("mode-testnet")).toContainText("Your wallet signs every run and every approval");
    await expect(page.getByTestId("mode-offline")).toContainText("OFFLINE");
    await expect(page.getByTestId("mode-offline").getByRole("link", { name: /Get the repository/ })).toHaveAttribute("href", /github\.com\/shane2512\/TAINT/);
    await page.getByTestId("mode-testnet").scrollIntoViewIfNeeded();
    await page.getByTestId("mode-testnet").getByRole("link", { name: /Connect and try it/ }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("[F77] the handle codes beside the widget keep changing", async ({ page }) => {
    await page.getByTestId("widget").scrollIntoViewIfNeeded();
    const code = page.locator(".scr.l span").first();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) { seen.add((await code.textContent()) ?? ""); await page.waitForTimeout(260); }
    expect(seen.size).toBeGreaterThan(2);
  });

  test("[F78] the questions open one at a time, and say what is not done", async ({ page }) => {
    await page.locator("#faq").scrollIntoViewIfNeeded();
    const q = (name: RegExp) => page.locator(".faq-q").filter({ hasText: name });
    await expect(q(/What does TAINT stop/)).toHaveAttribute("aria-expanded", "true");
    await q(/What is not done yet/).click();
    await expect(q(/What is not done yet/)).toHaveAttribute("aria-expanded", "true");
    await expect(q(/What does TAINT stop/)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".faq-row.on .faq-a")).toContainText("Mainnet");
    await expect(page.locator(".faq-row.on .faq-a")).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("[F11] content is there at once, with no smooth-scroll hijack", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/lenis-smooth/);
    await expect(page.getByTestId("dash-hero").locator(".bignum span")).toHaveText("1.500");
    await page.locator("#modes").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("mode-testnet")).toBeVisible();
  });
});

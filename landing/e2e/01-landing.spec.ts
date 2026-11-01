import { expect, fixture, listDir, readJson, test } from "./fixtures";

const SECTIONS = ["INTRO", "PROVENANCE", "WORKFLOW", "FEATURES", "POLICY DESK", "LIMITS", "BENCHMARK", "THE APP", "FAQ", "START"];

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => page.goto("/"));

  test("[F01] hero says what TAINT is and never hides its limits", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("CHECK WHO");
    await expect(page.locator(".hero-sub")).toContainText("TAINT checks who decided");
    await expect(page.locator(".fine").first()).toContainText("TESTNET ONLY");
    await expect(page.locator(".fine").first()).toContainText("TEE STUBBED");
  });

  test("[F02] the rail lists ten sections, and clicking one scrolls there and marks it", async ({ page }) => {
    await expect(page.locator(".rail li")).toHaveCount(SECTIONS.length);
    await page.locator(".rail li button").nth(3).click();
    await expect(page.locator(".rail li.on .rail-label")).toHaveText("FEATURES", { timeout: 6000 });
    await expect(page.locator(".nav nav a.on")).toHaveText("FEATURES");
    await page.getByRole("button", { name: "Next section" }).click();
    await expect(page.locator(".rail li.on .rail-label")).toHaveText("POLICY DESK", { timeout: 6000 });
  });

  test("[F03] the compare shows real fixture text and flags the values the attacker wrote", async ({ page }) => {
    await page.locator("#demo").scrollIntoViewIfNeeded();
    for (const id of ["F1", "F2", "F3"]) {
      const f = fixture(id);
      await page.locator(".seg").getByRole("button", { name: id, exact: true }).click();
      await expect(page.getByTestId("taint-view")).toContainText(f.attachments[0].source);
      for (const e of f.model_outputs.extractor) for (const v of [...e.accounts, ...e.tokens, ...e.amounts]) await expect(page.getByTestId("taint-view").locator("mark").filter({ hasText: v }).first()).toBeAttached();
      await expect(page.getByTestId("scenario-outcome")).toHaveText("HELD");
    }
    await page.locator(".seg").getByRole("button", { name: "L1", exact: true }).click();
    await expect(page.getByTestId("scenario-outcome")).toHaveText("DONE");
  });

  test("[F04] dragging the handle moves the divide between the two readings", async ({ page }) => {
    const box = page.getByTestId("compare");
    await box.scrollIntoViewIfNeeded();
    const view = page.getByTestId("taint-view");
    const before = await view.getAttribute("style");
    const b = (await box.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(view).not.toHaveAttribute("style", before!);
    expect(await view.getAttribute("style")).toContain("20");
  });

  test("[F05] the policy desk answers from the real rules", async ({ page }) => {
    const desk = page.getByTestId("policy-desk");
    await desk.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("verdict")).toContainText("HELD");
    await expect(page.getByTestId("verdict")).toContainText("recipient from x.com/@attacker");
    await desk.getByRole("tab", { name: "SOURCES" }).click();
    await desk.getByRole("group", { name: "RECIPIENT CAME FROM" }).getByRole("button", { name: "OWNER" }).click();
    await desk.getByRole("group", { name: "AMOUNT CAME FROM" }).getByRole("button", { name: "OWNER" }).click();
    await expect(page.getByTestId("verdict")).toContainText("EXECUTED");
  });

  test("[F06] the benchmark rows are the saved live results", async ({ page }) => {
    const file = listDir("bench", "results").filter((f) => f.endsWith("-LIVE.json")).at(-1)!;
    const { rows, model } = readJson("bench", "results", file);
    const count = (agent: string, kind: string, outcome: string) => rows.filter((r: any) => r.agent === agent && r.fixture.startsWith(kind) && r.outcome === outcome).length;
    const total = (agent: string, kind: string) => rows.filter((r: any) => r.agent === agent && r.fixture.startsWith(kind)).length;
    const list = page.getByTestId("bench-rows");
    await list.scrollIntoViewIfNeeded();
    await expect(list.locator("li").nth(0)).toContainText(`DRAINED ${count("naive", "F", "drained")}/${total("naive", "F")}`);
    await expect(list.locator("li").nth(1)).toContainText(`BLOCKED ${count("allowlist", "F", "blocked")}/${total("allowlist", "F")}`);
    await expect(list.locator("li").nth(1)).toContainText(`${count("allowlist", "L", "blocked")}/${total("allowlist", "L")}`);
    await expect(list.locator("li").nth(2)).toContainText(`HELD ${count("taint", "F", "pending")}/${total("taint", "F")}`);
    await expect(list.locator("li").nth(2)).toContainText(`${count("taint", "L", "ok")}/${total("taint", "L")}`);
    await expect(page.locator("#benchmark .note")).toContainText(model);
  });

  test("[F07] feature tiles and FAQ questions swap their detail panel", async ({ page }) => {
    await page.locator("#features").scrollIntoViewIfNeeded();
    await page.locator(".grid8").getByRole("button", { name: /24 HOUR CAP/ }).click();
    await expect(page.locator("#features .detail h3")).toHaveText("24 HOUR CAP");
    await page.locator("#faq").scrollIntoViewIfNeeded();
    await page.locator(".qs").getByRole("button", { name: /NOT DONE YET/ }).click();
    await expect(page.locator("#faq .detail p")).toContainText("Mainnet");
  });

  test("[F08] every way into the app works", async ({ page }) => {
    for (const [href, heading] of [["/demo", "ROB THE PET."], ["/cosign", "PENDING CO-SIGNS."], ["/wallet", "THE WALLET."], ["/policy", "THE POLICY."], ["/redteam", "THE RED TEAM."], ["/results", "THE RESULTS."]]) {
      await page.goto("/");
      await page.locator("#ecosystem").scrollIntoViewIfNeeded();
      await page.locator(`.eco a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
    await page.goto("/");
    await page.getByRole("link", { name: "OPEN THE APP" }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("[F09] smooth scroll is on, and the section headings finish as their real words", async ({ page }) => {
    await expect(page.locator("html")).toHaveClass(/lenis/);
    await page.locator("#workflow").scrollIntoViewIfNeeded();
    await expect(page.locator("#workflow h2")).toHaveText("FROM PROMPT TO PAYMENT.");
  });

  test("[F10] nothing from the reference site or filler text is left", async ({ page }) => {
    const text = await page.locator("body").innerText();
    for (const gone of [/pub crawl/i, /bar chat/i, /signal desk/i, /house board/i, /textmode/i, /opacity/i, /936/, /glyph ramp/i, /24 hours\b.*pending/i]) expect(text).not.toMatch(gone);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("[F11] content is there at once, with no smooth-scroll hijack", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#workflow h2")).toHaveText("FROM PROMPT TO PAYMENT.");
    await expect(page.locator("#workflow h2 span")).toHaveCSS("opacity", "1");
    await expect(page.locator("html")).not.toHaveClass(/lenis-smooth/);
    await expect(page.locator(".card").first()).toBeVisible();
  });
});

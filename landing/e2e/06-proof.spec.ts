import { expect, listDir, readJson, readText, test } from "./fixtures";

test.describe("red team", () => {
  test.beforeEach(async ({ page }) => page.goto("/redteam"));

  test("[F43] the attacks are listed before anything runs", async ({ page }) => {
    const ids = listDir("bench", "redteam").filter((f) => f.endsWith(".json"));
    await expect(page.getByTestId("redteam").locator("tbody tr")).toHaveCount(ids.length);
    await expect(page.getByTestId("redteam")).toContainText("NOT RUN");
  });

  test("[F44] running it holds everything except the two by-design cases", async ({ page }) => {
    await page.getByRole("button", { name: "RUN ALL TWELVE" }).click();
    const s = page.getByTestId("redteam-summary");
    await expect(s).toContainText("10 held or refused");
    await expect(s).toContainText("2 moved by design");
    await expect(s).toContainText("0 failures");
    const table = page.getByTestId("redteam");
    await expect(table).not.toContainText("NOT RUN");
    for (const id of ["R07", "R12"]) await expect(table.locator(`tr[data-id=${id}]`)).toContainText("Yes, by design");
    await expect(table.locator("tr[data-id=R01]")).toContainText("No");
  });

  test("[F45] the saved live runs show their error rows", async ({ page }) => {
    const files = listDir("bench", "results").filter((f) => /redteam.*\.md$/.test(f));
    const rows = page.getByTestId("live-redteam").locator("tbody tr");
    await expect(rows).toHaveCount(files.length);
    for (const [i, f] of files.entries()) {
      const t = readText("bench", "results", f);
      const errors = (t.match(/^\| R\d+ \|[^|]*\| error \|/gm) ?? []).length;
      const m = t.match(/attempts: (\d+) \| held or refused: (\d+) \| moved by design: (\d+) \| failures: (\d+)/)!;
      const cells = rows.nth(i).locator("td");
      await expect(cells.nth(1)).toHaveText(m[1]);
      await expect(cells.nth(4)).toHaveText(m[4]);
      await expect(cells.nth(5)).toHaveText(String(errors));
    }
  });
});

test.describe("results", () => {
  test.beforeEach(async ({ page }) => page.goto("/results"));

  test("[F46] the live replay table equals the saved run file", async ({ page }) => {
    const file = listDir("bench", "results").filter((f) => f.endsWith("-LIVE.json")).at(-1)!;
    const { rows } = readJson("bench", "results", file);
    for (const fx of ["F1", "F3", "L1", "L2"]) {
      const row = page.getByTestId("live-replay").locator(`tr[data-id=${fx}]`);
      for (const [i, agent] of ["naive", "allowlist", "taint"].entries()) {
        const outcomes = rows.filter((r: any) => r.fixture === fx && r.agent === agent);
        for (const o of new Set(outcomes.map((r: any) => r.outcome))) {
          const n = outcomes.filter((r: any) => r.outcome === o).length;
          await expect(row.locator("td").nth(i + 1).locator(".cellrow").filter({ has: page.locator(`[data-outcome="${o}"]`) })).toContainText(`${n}/${outcomes.length}`);
        }
      }
    }
  });

  test("[F47] the mock replay can be run, and matches its expectations", async ({ page }) => {
    await page.getByRole("button", { name: "RUN IT NOW" }).click();
    await expect(page.getByTestId("replay-summary")).toHaveText("15 OF 15 MATCH THEIR EXPECTATION");
    await expect(page.getByTestId("mock-replay").locator("tbody tr")).toHaveCount(5);
    await expect(page.getByTestId("mock-replay").locator("tr").filter({ hasText: "F1" }).locator("[data-outcome]").first()).toHaveAttribute("data-outcome", "drained");
  });

  test("[F48] testnet transactions link out, and what is not done is stated", async ({ page }) => {
    const links = page.getByTestId("tx-list").getByRole("link");
    await expect(links).toHaveCount(4);
    await expect(links.first()).toHaveAttribute("href", /^https:\/\/testnet\.nearblocks\.io\/txns\//);
    const notDone = page.getByTestId("not-done");
    for (const t of ["Mainnet", "real wallet signature", "TEE attestation", "full-access key"]) await expect(notDone).toContainText(t);
  });
});

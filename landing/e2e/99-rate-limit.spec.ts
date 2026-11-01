import { expect, preset, test } from "./fixtures";

// Last on purpose: it uses up the attack allowance for the next minute.
test("[F57] past the attack limit, the page says so and the wallets stay put", async ({ page, request }) => {
  let status = 200;
  for (let i = 0; i < 45 && status !== 429; i++) status = (await request.post("/api/attack", { data: { preset: "L2" } })).status();
  expect(status).toBe(429);
  await page.goto("/demo");
  await preset(page, "L2").click();
  await expect(page.locator(".error")).toContainText("rate limit");
  await expect(page.getByTestId("pet-taint")).toContainText("WAITING");
});

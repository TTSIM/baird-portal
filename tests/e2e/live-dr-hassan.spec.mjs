import { expect, test } from "@playwright/test";

test("live Dr Hassan returns a grounded citation", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_DR_HASSAN !== "1", "Set RUN_LIVE_DR_HASSAN=1 and DR_HASSAN_BASE_URL to run the paid live test.");

  await page.goto("/ask-dr-hassan.html");
  await page.getByPlaceholder("Ask anything about your course materials…").fill("Who discovered osseointegration?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(/Brånemark/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".source-link").first()).toBeVisible();
});

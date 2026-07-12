import { expect, test } from "@playwright/test";

const successStream = [
  { type: "delta", text: "Osseointegration is the direct structural and functional connection " },
  { type: "delta", text: "between living bone and an implant surface." },
  {
    type: "done",
    answer: "Osseointegration is the direct structural and functional connection between living bone and an implant surface.",
    citations: [{
      label: "Foundations — History, Bone Biology & Osteointegration",
      href: "/materials/lectures/lecture_1_foundations_history_bone_biology.html",
      type: "Lecture",
      excerpt: "Bone forms a direct connection to the titanium implant surface."
    }]
  }
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

test.beforeEach(async ({ page }) => {
  await page.route("**/api/ask-dr-hassan", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: successStream });
  });
});

test("portal exposes an isolated Ask Dr Hassan navigation link", async ({ page }) => {
  await page.goto("/baird_implant_portal.html");
  await page.getByRole("tab", { name: "Faculty" }).click();
  await expect(page.getByRole("heading", { name: "Faculty" })).toBeVisible();
  await page.getByRole("tab", { name: "Modules" }).click();
  await expect(page.getByRole("heading", { name: "Modules" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask Dr Hassan" })).toHaveAttribute("href", "ask-dr-hassan.html");
  await page.getByRole("link", { name: "Ask Dr Hassan" }).click();
  await expect(page).toHaveURL(/ask-dr-hassan\.html$/);
  await expect(page.getByPlaceholder("Ask anything about your course materials…")).toBeFocused();
});

test("renders the minimal home state and a cited streamed answer", async ({ page }) => {
  await page.goto("/ask-dr-hassan.html");
  await expect(page.getByText("Your BAIRD course companion.")).toBeVisible();
  await page.getByPlaceholder("Ask anything about your course materials…").fill("Explain osseointegration");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Explain osseointegration", { exact: true })).toBeVisible();
  await expect(page.getByText(/direct structural and functional connection/)).toBeVisible();
  const source = page.getByRole("link", { name: /Foundations — History/ });
  await expect(source).toHaveAttribute("href", "/materials/lectures/lecture_1_foundations_history_bone_biology.html");
  await expect(page.locator(".message.assistant .sources-title")).toBeVisible();
});

test("supports multiline input, keyboard submission, and clearing the session", async ({ page }) => {
  await page.goto("/ask-dr-hassan.html");
  const input = page.getByPlaceholder("Ask anything about your course materials…");
  await input.fill("First line");
  await input.press("Shift+Enter");
  await input.type("Second line");
  await expect(input).toHaveValue("First line\nSecond line");
  await input.press("Enter");

  await expect(page.getByText("First line\nSecond line", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear chat" }).click();
  await expect(page.getByText("Your BAIRD course companion.")).toBeVisible();
  await expect(page.getByText("First line\nSecond line", { exact: true })).toHaveCount(0);
});

test("shows a friendly rate-limit failure", async ({ page }) => {
  await page.unroute("**/api/ask-dr-hassan");
  await page.route("**/api/ask-dr-hassan", (route) => route.fulfill({
    status: 429,
    contentType: "application/json",
    headers: { "Retry-After": "60" },
    body: JSON.stringify({ error: "Dr Hassan has received a lot of questions. Please wait a moment and try again.", code: "RATE_LIMITED" })
  }));

  await page.goto("/ask-dr-hassan.html");
  await page.getByPlaceholder("Ask anything about your course materials…").fill("A question");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(/received a lot of questions/)).toBeVisible();
  await expect(page.getByPlaceholder("Ask anything about your course materials…")).toBeEnabled();
});

test("keeps the composer usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ask-dr-hassan.html");
  const input = page.getByPlaceholder("Ask anything about your course materials…");
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "Send question" })).toBeVisible();
  const box = await input.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

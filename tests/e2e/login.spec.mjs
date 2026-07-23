import { expect, test } from "@playwright/test";

test("root is the Google authentication landing page when signed out", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Sign in to continue." })
  }));
  await page.route("**/api/auth/config", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Google sign-in has not been configured." })
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Learning Portal" })).toBeVisible();
  await expect(page.getByText("Sign in with the Google account approved for your course.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("root sends an authenticated user to the portal", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "owner-1", name: "Sim Singh", email: "simsingh@gmail.com", role: "owner", grants: [] },
      portal: {
        program: { title: "BAIRD", subtitle: "", details: [], faculty: [], yearsRunning: 20 },
        courses: [],
        modules: [],
        stats: { modules: 0, faculty: 0, materials: 0, yearsRunning: 20 }
      }
    })
  }));

  await page.goto("/");
  await expect(page).toHaveURL(/baird_implant_portal\.html$/);
});

test("root sends an authenticated user with an incomplete profile to setup", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "delegate-1",
        name: "Test Delegate",
        email: "delegate@example.com",
        role: "delegate",
        grants: [],
        profileComplete: false
      }
    })
  }));

  await page.goto("/?next=/baird_implant_portal.html?tab=community");
  await expect(page).toHaveURL(/profile-setup\.html\?next=%2Fbaird_implant_portal\.html%3Ftab%3Dcommunity$/);
});

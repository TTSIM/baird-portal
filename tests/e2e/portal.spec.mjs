import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const catalog = JSON.parse(await readFile(new URL("../../data/course-catalog.json", import.meta.url), "utf8"));

function portalPayload(grants = ["implant-module-1"]) {
  const granted = new Set(grants);
  const enrolledIds = new Set(catalog.courses
    .filter((course) => course.moduleIds.some((id) => granted.has(id)))
    .map(({ id }) => id));
  const modules = catalog.modules
    .filter((module) => enrolledIds.has(module.courseId))
    .map((module) => granted.has(module.id)
      ? { ...module, locked: false }
      : {
          id: module.id,
          courseId: module.courseId,
          title: module.title,
          typeLabel: module.typeLabel,
          date: module.date,
          topics: module.topics,
          locked: true
        });

  return {
    user: {
      id: "delegate-1",
      name: "Test Delegate",
      email: "delegate@example.com",
      role: "delegate",
      grants,
      profileComplete: true
    },
    features: { community: false },
    portal: {
      version: catalog.version,
      academy: catalog.academy,
      courses: catalog.courses.map((course) => ({
        ...course,
        enrolled: enrolledIds.has(course.id),
        availableItems: course.moduleIds.filter((id) => granted.has(id)).length,
        totalItems: course.moduleIds.length
      })),
      faculty: catalog.faculty,
      modules,
      stats: {
        enrolledCourses: enrolledIds.size,
        availableItems: grants.length,
        faculty: catalog.faculty.length,
        materials: 3,
        yearsRunning: catalog.academy.yearsRunning
      }
    }
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(portalPayload())
  }));
});

test("shows enrolled learning first and a protected nine-module roadmap", async ({ page }) => {
  await page.goto("/baird_implant_portal.html");
  await expect(page.locator(".course-card")).toHaveCount(1);
  await expect(page.locator(".catalogue-card")).toHaveCount(7);

  for (const course of catalog.courses.filter(({ id }) => id !== "implant-dentistry-2026")) {
    await expect(page.getByRole("heading", { name: course.title, exact: true })).toHaveCount(1);
  }

  await page.locator(".course-card").click();
  await expect(page).toHaveURL(/course=implant-dentistry-2026/);
  await expect(page.locator(".curriculum-item")).toHaveCount(9);
  await expect(page.locator("details.curriculum-item")).toHaveCount(1);
  await expect(page.locator(".curriculum-item--locked")).toHaveCount(8);
  await expect(page.locator(".curriculum-item--locked .resource-link")).toHaveCount(0);

  if (process.env.CAPTURE_PORTAL_VISUAL === "1") {
    await page.screenshot({ path: "/tmp/baird-portal-course-desktop.png", fullPage: true });
  }
});

test("filters faculty by course and uses portrait fallbacks", async ({ page }) => {
  await page.goto("/baird_implant_portal.html?view=faculty");
  await expect(page.locator(".faculty-card")).toHaveCount(14);
  await page.locator("#faculty-course-filter").selectOption("oral-surgery-mastery-2026");
  await expect(page.locator(".faculty-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Dr Shankar Narayan" })).toBeVisible();
  await expect(page.locator(".faculty-avatar")).toContainText("SN");
});

test("keeps the course library usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/baird_implant_portal.html");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".course-card")).toBeVisible();

  if (process.env.CAPTURE_PORTAL_VISUAL === "1") {
    await page.screenshot({ path: "/tmp/baird-portal-mobile.png", fullPage: true });
  }
});

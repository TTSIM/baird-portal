import { expect, test } from "@playwright/test";

test("admin reviews usage, changes grants, and manages private knowledge", async ({ page }) => {
  let patchedUser = null;
  const courses = [{
    id: "implant-dentistry-2026",
    title: "Implant Dentistry",
    intake: "2026",
    modules: [
      { id: "implant-module-1", title: "Module 1" },
      { id: "implant-module-2", title: "Module 2" }
    ]
  }, {
    id: "implant-overdentures-masterclass",
    title: "Implant Overdentures Masterclass",
    intake: "",
    modules: []
  }];

  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "admin-1", name: "BAIRD Admin", email: "admin@example.com", role: "admin", grants: [] },
      portal: { academy: {}, courses: [], faculty: [], modules: [], stats: {} }
    })
  }));
  await page.route("**/api/admin/usage**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      metrics: { totalQuestions: 12, successfulAnswers: 10, activeDelegates: 3, errors: 1, inputTokens: 2300, outputTokens: 900 },
      records: [{
        id: "usage-1",
        createdAt: "2026-07-23T09:00:00.000Z",
        user: { id: "delegate-1", name: "Test Delegate", email: "delegate@example.com", role: "delegate" },
        question: "What is osseointegration?",
        status: "success",
        usage: { inputTokens: 100, outputTokens: 40 },
        matchedCourseIds: ["implant-dentistry-2026"],
        matchedModuleIds: ["implant-module-1"],
        citations: [{ label: "Foundations lecture" }]
      }],
      pagination: { page: 1, pageSize: 50, pageCount: 1, total: 1 }
    })
  }));
  await page.route("**/api/admin/users", async (route) => {
    if (route.request().method() === "PATCH") {
      patchedUser = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: {} }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses,
        users: [{
          id: "delegate-1",
          name: "Test Delegate",
          email: "delegate@example.com",
          role: "delegate",
          active: true,
          grants: ["implant-module-1"],
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          lastLoginAt: "2026-07-22T12:00:00.000Z"
        }]
      })
    });
  });
  await page.route("**/api/admin/knowledge**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      courses,
      sources: [{
        id: "source-1",
        title: "External implant lecture",
        originalFilename: "external-lecture.pdf",
        bytes: 245760,
        courseId: "implant-dentistry-2026",
        status: "ready",
        uploadedBy: { id: "admin-1", name: "BAIRD Admin", email: "admin@example.com" },
        createdAt: "2026-07-23T08:00:00.000Z",
        updatedAt: "2026-07-23T08:01:00.000Z"
      }]
    })
  }));

  await page.goto("/admin.html");
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("What is osseointegration?")).toBeVisible();

  await page.getByRole("button", { name: "Users" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("[data-user-form='delegate-1'] select[name='role'] option")).toHaveCount(1);
  await expect(page.getByText("No learning items have been added yet.")).toBeVisible();
  await page.getByLabel("Module 2").check();
  await page.getByRole("button", { name: "Save" }).click();
  expect(patchedUser.grants).toEqual(["implant-module-1", "implant-module-2"]);

  await page.getByRole("button", { name: "Knowledge" }).click();
  await expect(page.getByText("External implant lecture")).toBeVisible();
  await expect(page.getByText("external-lecture.pdf")).toBeVisible();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
});

test("owner can edit privileged users and assign every role", async ({ page }) => {
  let patchedUser = null;
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "owner-1", name: "Sim Singh", email: "simsingh@gmail.com", role: "owner", grants: [] },
      portal: { academy: {}, courses: [], faculty: [], modules: [], stats: {} }
    })
  }));
  await page.route("**/api/admin/usage**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      metrics: { totalQuestions: 0, successfulAnswers: 0, activeDelegates: 0, errors: 0, inputTokens: 0, outputTokens: 0 },
      records: [],
      pagination: { page: 1, pageSize: 50, pageCount: 1, total: 0 }
    })
  }));
  await page.route("**/api/admin/users", (route) => {
    if (route.request().method() === "PATCH") {
      patchedUser = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: {} }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [],
        users: [
          { id: "owner-1", name: "Sim Singh", email: "simsingh@gmail.com", role: "owner", active: true, grants: [] },
          { id: "admin-1", name: "Admin User", email: "admin@example.com", role: "admin", active: true, grants: [] }
        ]
      })
    });
  });

  await page.goto("/admin.html");
  await page.getByRole("button", { name: "Users" }).click();
  const adminRow = page.getByText("Admin User", { exact: true }).locator("..");
  await adminRow.getByRole("button", { name: "Edit" }).click();
  const roleSelect = page.locator("[data-user-form='admin-1'] select[name='role']");
  await expect(roleSelect.locator("option")).toHaveCount(3);
  await roleSelect.selectOption("owner");
  await page.locator("[data-user-form='admin-1']").getByRole("button", { name: "Save" }).click();
  expect(patchedUser.role).toBe("owner");
});

test("admin reviews community reports, removes images, and sees moderation history", async ({ page }) => {
  let moderationAction = null;
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "admin-1", name: "BAIRD Admin", email: "admin@example.com", role: "admin", grants: [] },
      portal: { academy: {}, courses: [], faculty: [], modules: [], stats: {} }
    })
  }));
  await page.route("**/api/admin/usage**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      metrics: { totalQuestions: 0, successfulAnswers: 0, activeDelegates: 0, errors: 0, inputTokens: 0, outputTokens: 0 },
      records: [],
      pagination: { page: 1, pageSize: 50, pageCount: 1, total: 0 }
    })
  }));
  await page.route("**/api/admin/users", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ courses: [], users: [] })
  }));
  await page.route("**/api/admin/community", (route) => {
    if (route.request().method() === "PATCH") moderationAction = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reports: [{
          id: "report-1",
          targetType: "post",
          targetId: "post-1",
          postId: "post-1",
          reason: "patient-confidentiality",
          details: "Please check the image.",
          createdAt: "2026-07-23T09:00:00.000Z",
          reporter: { id: "delegate-2", name: "Amina Patel", email: "amina@example.com" },
          target: {
            title: "Case support",
            body: "A clinical discussion.",
            status: "active",
            attachments: [{ id: "image-1", filename: "case-photo.jpg" }]
          }
        }],
        content: [{
          targetType: "post",
          id: "post-2",
          title: "Locked discussion",
          status: "active",
          lockedAt: "2026-07-23T09:30:00.000Z",
          updatedAt: "2026-07-23T09:30:00.000Z"
        }],
        moderation: [{
          id: "mod-1",
          actorId: "admin-1",
          actor: { id: "admin-1", name: "BAIRD Admin" },
          action: "lock",
          targetType: "post",
          targetId: "post-2",
          reason: "Awaiting review",
          createdAt: "2026-07-23T09:30:00.000Z"
        }]
      })
    });
  });

  await page.goto("/admin.html");
  await page.getByRole("button", { name: "Community" }).click();
  await expect(page.getByText("patient confidentiality")).toBeVisible();
  await expect(page.getByText("case-photo.jpg", { exact: false })).toBeVisible();
  await expect(page.getByText("Awaiting review")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove case-photo.jpg" }).click();
  expect(moderationAction).toEqual({
    action: "remove-image",
    targetType: "attachment",
    targetId: "image-1"
  });
  await expect(page.getByText("Community moderation updated.")).toBeVisible();
});

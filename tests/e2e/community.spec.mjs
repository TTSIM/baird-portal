import { expect, test } from "@playwright/test";

const reactions = (overrides = {}) => ({
  helpful: { count: 0, reacted: false },
  thanks: { count: 0, reacted: false },
  insightful: { count: 0, reacted: false },
  ...overrides
});

const currentAuthor = {
  id: "delegate-1",
  name: "Test Delegate",
  location: "Leeds",
  role: "delegate",
  completedCourseIds: ["implant-dentistry-2026"]
};

const colleague = {
  id: "delegate-2",
  name: "Amina Patel",
  location: "Manchester",
  role: "delegate",
  completedCourseIds: []
};

function portalPayload() {
  return {
    user: {
      id: currentAuthor.id,
      name: currentAuthor.name,
      email: "private@example.com",
      role: "delegate",
      grants: ["implant-module-1"],
      profileComplete: true,
      profile: currentAuthor
    },
    features: { community: true },
    portal: {
      program: {
        title: "BAIRD Evidence Based & Clinical Implant Dentistry",
        subtitle: "2026 Programme",
        details: [["2026 Intake"]],
        faculty: ["Dr Hassan"],
        yearsRunning: 20
      },
      courses: [{ id: "implant-dentistry-2026", title: "Implant Dentistry", intake: "2026" }],
      modules: [{
        id: "implant-module-1",
        courseId: "implant-dentistry-2026",
        title: "Module 1",
        days: [],
        locked: false
      }],
      stats: { modules: 1, faculty: 1, materials: 1, yearsRunning: 20 }
    }
  };
}

test("creates, discusses, reacts to, reports, and resolves community threads", async ({ page }) => {
  const createdAt = "2026-07-23T10:00:00.000Z";
  let nestedReplyBody = null;
  let reportPayload = null;
  let reactionChanged = false;
  let postCreated = false;
  let thread = {
    id: "post-1",
    author: currentAuthor,
    title: "Need support with immediate loading",
    body: "How are colleagues approaching temporisation in this scenario?",
    category: "case-support",
    courseId: "implant-dentistry-2026",
    attachments: [],
    status: "active",
    createdAt,
    updatedAt: createdAt,
    activityAt: createdAt,
    replyCount: 1,
    reactions: reactions(),
    canEdit: true,
    replies: [{
      id: "reply-1",
      postId: "post-1",
      depth: 1,
      author: colleague,
      body: "I would first reassess stability and occlusal loading.",
      status: "active",
      createdAt: "2026-07-23T10:15:00.000Z",
      updatedAt: "2026-07-23T10:15:00.000Z",
      reactions: reactions(),
      canEdit: false
    }]
  };

  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(portalPayload())
  }));
  await page.route("**/api/community/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value)
    });

    if (url.pathname === "/api/community/notifications") {
      return json({
        unreadCount: 1,
        notifications: [{
          id: "notification-1",
          kind: "reply",
          postId: "post-1",
          actor: colleague,
          createdAt: "2026-07-23T10:15:00.000Z"
        }]
      });
    }
    if (url.pathname === "/api/community/posts" && request.method() === "GET") {
      return json({ posts: [thread], nextCursor: null });
    }
    if (url.pathname === "/api/community/posts" && request.method() === "POST") {
      postCreated = true;
      const body = request.postDataJSON();
      thread = {
        ...thread,
        id: "post-2",
        title: body.title,
        body: body.body,
        category: body.category,
        courseId: undefined,
        replyCount: 0,
        replies: []
      };
      return json({ post: thread }, 201);
    }
    if (url.pathname === `/api/community/posts/${thread.id}` && request.method() === "GET") {
      return json({ post: thread });
    }
    if (url.pathname === "/api/community/posts/post-1/replies" && request.method() === "POST") {
      const body = request.postDataJSON();
      nestedReplyBody = body;
      const nested = {
        id: "reply-2",
        postId: "post-1",
        parentReplyId: body.parentReplyId,
        depth: 2,
        author: currentAuthor,
        body: body.body,
        status: "active",
        createdAt: "2026-07-23T10:20:00.000Z",
        updatedAt: "2026-07-23T10:20:00.000Z",
        reactions: reactions(),
        canEdit: true
      };
      thread = { ...thread, replies: [...thread.replies, nested], replyCount: 2 };
      return json({ reply: nested, post: thread }, 201);
    }
    if (url.pathname === "/api/community/posts/post-1/accepted-reply") {
      const { replyId } = request.postDataJSON();
      thread = { ...thread, acceptedReplyId: replyId, resolvedAt: "2026-07-23T10:25:00.000Z" };
      return json({ post: thread });
    }
    if (url.pathname === "/api/community/reactions/post/post-1/helpful") {
      reactionChanged = true;
      return json({ reactions: reactions({ helpful: { count: 1, reacted: true } }) });
    }
    if (url.pathname === "/api/community/reports") {
      reportPayload = request.postDataJSON();
      return json({ report: { id: "report-1", status: "open" } }, 201);
    }
    return json({ error: `Unhandled ${request.method()} ${url.pathname}` }, 500);
  });

  await page.goto("/baird_implant_portal.html?tab=community");
  await expect(page.getByRole("tab", { name: "Community" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Need support with immediate loading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
  await page.getByText("Need support with immediate loading").click();
  await expect(page).toHaveURL(/tab=community&thread=post-1/);

  await page.locator(".community-reply").getByRole("button", { name: "Reply" }).click();
  await page.getByPlaceholder("Add a clear, constructive reply").fill("That is helpful; I would also review the provisional contacts.");
  await page.getByRole("button", { name: "Publish reply" }).click();
  await expect(page.getByText("That is helpful; I would also review the provisional contacts.")).toBeVisible();
  expect(nestedReplyBody.parentReplyId).toBe("reply-1");

  await page.locator(".community-thread-header").getByRole("button", { name: "Helpful" }).click();
  expect(reactionChanged).toBe(true);
  await expect(page.locator(".community-thread-header").getByRole("button", { name: "Helpful 1" })).toHaveAttribute("aria-pressed", "true");

  await page.locator(".community-reply").first().getByRole("button", { name: "Accept answer" }).click();
  await expect(page.getByText("Accepted answer")).toBeVisible();
  await expect(page.locator(".community-thread .community-resolved")).toBeVisible();

  await page.locator(".community-reply").first().getByRole("button", { name: "Report" }).click();
  await page.getByLabel("Reason").selectOption("unsafe-advice");
  await page.getByLabel("Additional detail").fill("Please review the clinical framing.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent to BAIRD administrators.")).toBeVisible();
  expect(reportPayload.reason).toBe("unsafe-advice");

  await page.getByRole("button", { name: "Back to discussions" }).click();
  await page.getByRole("button", { name: "Ask the community" }).click();
  await page.getByLabel("Title").fill("Question about restorative planning");
  await page.getByLabel("Details").fill("Which course resources should I revisit before the next session?");
  await page.getByRole("button", { name: "Publish discussion" }).click();
  await expect(page.locator("#community-thread").getByRole("heading", { name: "Question about restorative planning" })).toBeVisible();
  expect(postCreated).toBe(true);
});

test("completes the mandatory first-login profile on mobile", async ({ page }) => {
  let saved = null;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/profile", (route) => {
    if (route.request().method() === "PATCH") {
      saved = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: { ...saved, profileCompletedAt: "2026-07-23T11:00:00.000Z" } })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          id: "delegate-1",
          email: "private@example.com",
          name: "Test Delegate",
          location: "",
          role: "delegate",
          googlePictureUrl: "https://example.com/avatar.jpg",
          completedCourseIds: ["implant-dentistry-2026"],
          notificationPreferences: {
            emailReplies: true,
            emailMentions: true,
            emailAcceptedAnswers: true
          }
        }
      })
    });
  });
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(portalPayload())
  }));

  await page.goto("/profile-setup.html?next=/baird_implant_portal.html");
  await expect(page.getByRole("heading", { name: "Set up your delegate profile" })).toBeVisible();
  await expect(page.getByText("Implant Dentistry")).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Dr Test Delegate");
  await page.locator("#profile-location").fill("Leeds");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/baird_implant_portal\.html$/);
  expect(saved.name).toBe("Dr Test Delegate");
  expect(saved.location).toBe("Leeds");
  expect(saved.notificationPreferences.emailReplies).toBe(true);
});

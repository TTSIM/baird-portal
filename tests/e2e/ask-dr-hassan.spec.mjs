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

const portalFixture = {
  academy: { name: "BAIRD Academy", title: "BAIRD Learning Portal", yearsRunning: 20 },
  courses: [{
    id: "implant-dentistry-2026",
    title: "BAIRD Evidence Based & Clinical Implant Dentistry",
    shortTitle: "Implant Dentistry",
    intake: "2026 Intake",
    summary: "A year-long clinical implant dentistry programme.",
    status: "registration-open",
    statusLabel: "Registration open",
    sourceUrl: "https://bairdacademyuk.com/",
    contentLabels: { singular: "Module", plural: "Modules" },
    facultyIds: ["dr-hassan"],
    moduleIds: ["implant-module-1"],
    enrolled: true,
    availableItems: 1,
    totalItems: 1
  }],
  faculty: [{
    id: "dr-hassan",
    name: "Dr Hassan Maghaireh",
    role: "Course director",
    bio: "BAIRD course director.",
    courseIds: ["implant-dentistry-2026"]
  }],
  modules: [{
    id: "implant-module-1",
    courseId: "implant-dentistry-2026",
    title: "Module 1",
    date: "January 2026",
    topics: "Foundations",
    days: [],
    locked: false
  }],
  stats: { enrolledCourses: 1, availableItems: 1, faculty: 1, materials: 1, yearsRunning: 20 }
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "delegate-1",
          name: "Test Delegate",
          email: "delegate@example.com",
          role: "delegate",
          grants: ["implant-module-1"]
        },
        portal: portalFixture
      })
    });
  });
  await page.route("**/api/ask-dr-hassan", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: successStream });
  });
});

test("portal exposes an isolated Ask Dr Hassan navigation link", async ({ page }) => {
  await page.goto("/baird_implant_portal.html");
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  await page.getByRole("button", { name: "Faculty" }).click();
  await expect(page.getByRole("heading", { name: "Meet the faculty." })).toBeVisible();
  await page.getByRole("button", { name: "My Learning" }).click();
  await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask Dr Hassan" })).toHaveAttribute("href", "ask-dr-hassan.html");
  await page.getByText("Test Delegate", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Backend dashboard" })).toHaveCount(0);
  await page.getByRole("link", { name: "Ask Dr Hassan" }).click();
  await expect(page).toHaveURL(/ask-dr-hassan\.html$/);
  await expect(page.getByPlaceholder("Ask anything about your course materials…")).toBeFocused();
});

test("owner sees the Backend dashboard navigation", async ({ page }) => {
  await page.unroute("**/api/me");
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "owner-1", name: "Sim Singh", email: "simsingh@gmail.com", role: "owner", grants: [] },
      portal: {
        academy: { name: "BAIRD Academy", title: "BAIRD Learning Portal", yearsRunning: 20 },
        courses: [],
        faculty: [],
        modules: [],
        stats: { enrolledCourses: 0, availableItems: 0, faculty: 0, materials: 0, yearsRunning: 20 }
      }
    })
  }));
  await page.goto("/baird_implant_portal.html");
  await page.getByText("Sim Singh", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Backend dashboard" })).toBeVisible();
});

test("renders the minimal home state and a cited streamed answer", async ({ page }) => {
  await page.goto("/ask-dr-hassan.html");
  await expect(page.getByText("Your BAIRD course companion.")).toBeVisible();
  await expect(page.getByText(/not Dr Hassan responding live/)).toBeVisible();
  await expect(page.getByLabel("Animated Dr Hassan AI companion")).toHaveAttribute("data-state", "idle");
  await page.getByPlaceholder("Ask anything about your course materials…").fill("Explain osseointegration");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Explain osseointegration", { exact: true })).toBeVisible();
  await expect(page.getByText(/direct structural and functional connection/)).toBeVisible();
  const source = page.getByRole("link", { name: /Foundations — History/ });
  await expect(source).toHaveAttribute("href", "/materials/lectures/lecture_1_foundations_history_bone_biology.html");
  await expect(page.locator(".message.assistant .sources-title")).toBeVisible();
  await expect(page.getByLabel("Animated Dr Hassan AI companion")).toHaveAttribute("data-state", "success");
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
  await expect(page.getByLabel("Animated Dr Hassan AI companion")).toHaveAttribute("data-state", "idle");
  await expect(page.locator("#companion-home-slot #companion-mount")).toBeVisible();
});

test("animates through searching, answering, and completion states", async ({ page }) => {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    window.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        window.setTimeout(() => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: "A grounded answer is arriving." })}\n\n`));
        }, 180);
        window.setTimeout(() => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "done",
            answer: "A grounded answer is arriving.",
            citations: [{
              label: "A BAIRD lecture",
              href: "/materials/lectures/lecture_1_foundations_history_bone_biology.html",
              type: "Lecture",
              excerpt: "Supporting course text."
            }]
          })}\n\n`));
          controller.close();
        }, 850);
      }
    }), { headers: { "Content-Type": "text/event-stream" } });
  });

  await page.goto("/ask-dr-hassan.html");
  await page.getByPlaceholder("Ask anything about your course materials…").fill("Teach me something");
  await page.getByRole("button", { name: "Send question" }).click();

  const companion = page.getByLabel("Animated Dr Hassan AI companion");
  await expect(companion).toHaveAttribute("data-state", "searching");
  await expect(companion).toHaveAttribute("data-state", "answering", { timeout: 600 });
  await expect(companion).toHaveAttribute("data-state", "success", { timeout: 1400 });
  await expect(page.getByRole("link", { name: /A BAIRD lecture/ })).toBeVisible();
});

test("greets on activation and remembers show or hide preference", async ({ page }) => {
  await page.goto("/ask-dr-hassan.html");
  const companion = page.getByLabel("Animated Dr Hassan AI companion");
  await page.getByRole("button", { name: "Greet the Dr Hassan companion" }).click();
  await expect(companion).toHaveAttribute("data-state", "greeting");
  await expect(page.locator("#companion-bubble")).toBeVisible();

  await page.getByRole("button", { name: "Hide the Dr Hassan companion" }).click();
  await expect(companion).toBeHidden();
  await expect(page.getByRole("button", { name: "Show Dr Hassan" })).toBeVisible();

  await page.reload();
  await expect(companion).toBeHidden();
  await page.getByRole("button", { name: "Show Dr Hassan" }).click();
  await expect(companion).toBeVisible();

  await page.reload();
  await expect(companion).toBeVisible();
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
  await expect(page.getByLabel("Animated Dr Hassan AI companion")).toHaveAttribute("data-state", "error");
});

test("renders private knowledge as a generic non-clickable citation", async ({ page }) => {
  await page.unroute("**/api/ask-dr-hassan");
  const stream = [
    { type: "delta", text: "A supported answer." },
    {
      type: "done",
      answer: "A supported answer.",
      citations: [{
        label: "Additional BAIRD course reference",
        type: "Private course reference",
        excerpt: "",
        private: true
      }]
    }
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  await page.route("**/api/ask-dr-hassan", (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: stream
  }));

  await page.goto("/ask-dr-hassan.html");
  await page.getByPlaceholder("Ask anything about your course materials…").fill("Summarise the extra lecture");
  await page.getByRole("button", { name: "Send question" }).click();
  const privateSource = page.locator(".private-source");
  await expect(privateSource).toContainText("Additional BAIRD course reference");
  await expect(privateSource).not.toHaveAttribute("href");
  await expect(page.getByText("Confidential external lecture")).toHaveCount(0);
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

  await input.fill("A mobile question");
  await page.getByRole("button", { name: "Send question" }).click();
  const avatarBox = await page.getByRole("button", { name: "Greet the Dr Hassan companion" }).boundingBox();
  expect(avatarBox.x).toBeGreaterThanOrEqual(0);
  expect(avatarBox.x + avatarBox.width).toBeLessThanOrEqual(390);
});

test("persists the learner theme between portal, profile, and Ask Dr Hassan", async ({ page }) => {
  await page.goto("/baird_implant_portal.html");
  await page.getByRole("button", { name: "Dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/profile-setup.html");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/ask-dr-hassan.html");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("honours reduced-motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ask-dr-hassan.html");
  const animationDuration = await page.locator(".avatar-sprite").evaluate(
    (element) => window.getComputedStyle(element).animationDuration
  );
  expect(parseFloat(animationDuration)).toBeLessThanOrEqual(0.01);
});
